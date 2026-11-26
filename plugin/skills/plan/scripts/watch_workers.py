"""Check every worker an orchestrator has fanned work out to, and say which ones stalled.

Part of the Claudius `plan` skill (its Watch step). A worker is a Claude Code cloud session (it pushes a branch and
opens a PR on GitHub) or a local git worktree. Each call checks every worker once and turns "no progress since the
last check" into a nudge, and "still nothing after a nudge" into a restart. Meant for the Monitor tool (loop mode),
or `/loop 1m` with one `--once` call per tick where Monitor is not available.

    python3 -I watch_workers.py --workers workers.json [--every 60] [--max-minutes 120]  # loop; prints only changes
    python3 -I watch_workers.py --workers workers.json --once       # one JSON line per worker, exit 0
    python3 -I watch_workers.py --workers workers.json --reset NAME  # forget NAME's state (after a restart)
    python3 -I watch_workers.py --workers workers.json --once --busy api-fix   # api-fix shows busy right now

workers.json is a list; a worker has `name` and either `repo` + `branch` (+ optional `pr`) or `path`:

    [{"name": "api-fix", "repo": "owner/repo", "branch": "claude/api-fix", "pr": 12},
     {"name": "docs", "repo": "owner/repo", "branch": "claude/docs"},
     {"name": "local", "path": "~/src/repo/.claude/worktrees/x"}]

Loop mode exits when every worker is done, or once --max-minutes (default 120) have passed since the watch's first check
(kept in the state file, so a restarted loop does not start the count again), printing each unfinished worker's last
row on the way out. A worker that is done is not read again in that loop: one `done` stays done.

A throttled read (GitHub rate limit) shows `ok` for up to 10 minutes in a row, then as an error with signal `rate limited`.
A ready PR with CI pending shows `ok`, signal `ci pending`, for up to 20 minutes from when CI first showed pending.
At most 8 workers: more exits 2 (each cloud worker costs up to 5 `gh api` calls a minute against the shared 5,000/hr limit).

Output line: {"name","signal","idle_min","pr":{"number","state","ci"}|null,"verdict":"ok|nudge|restart|done"}.
Progress for a cloud worker is the branch's newest sha plus the PR's head sha, state and check rollup (comments and
description edits are not progress). For a local worker it is HEAD plus a hash of `git status --porcelain`.
A worker is done when its PR is merged at the branch's newest sha (or the branch is gone), or ready for review (not a
draft) with CI green or absent there, on two checks in a row. A done worker stays done through a failed read.
Branch names are assumed unique per worker, as the app's sessions make them: a reused name can match an old PR. An error reading a worker is not progress: one that keeps failing is nudged, then restarted, like a quiet
one, and its signal names the error. State between calls (last fingerprint, when it changed, whether a nudge went out)
is in --state, default $TMPDIR/watch_workers.<hash of the workers file path>.state.json, so two plans never share it. Needs `gh` (signed in) for cloud workers, and reads GitHub by REST only (`gh api repos/...`), so it runs in a cloud session, whose proxy blocks GraphQL; it reads no tokens itself. Standard library
only.
"""

import argparse
import errno
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

try:
    import fcntl  # POSIX; without it (Windows) state writes go unlocked
except ImportError:
    fcntl = None

NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)  # 0 where the platform has none
NUDGE_AFTER_MIN = 1          # quiet this long -> nudge
RESTART_AFTER_NUDGE_MIN = 1  # still quiet this long after the nudge -> restart
THROTTLE_ERROR_AFTER_MIN = 10  # throttled reads this long in a row count as an error, so nudge and restart apply
CI_PENDING_GRACE_MIN = 20     # a ready PR with CI pending is "ok" this long from when CI first showed pending
MAX_WORKERS = 8               # each cloud worker costs up to 5 gh api calls a minute against a shared 5,000/hr limit
BUSY_GRACE_MIN = 10          # a session shown busy may go this long without a push (the contract's draft-PR limit)
RATE_LIMIT = re.compile(r"rate limit|HTTP 429|abuse detection|secondary rate", re.I)
FAILED = {"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"}
PASSED = {"SUCCESS", "NEUTRAL", "SKIPPED"}


def verdict(idle_min, since_nudge_min, busy):
    """The stall rule. "done" is decided before this is called; since_nudge_min is None until a nudge went out."""
    # One quiet minute -> nudge; one more after the nudge -> restart. A worker shown busy gets the contract's
    # 10 minutes to push: one writing a single large file can look idle for minutes and then land it.
    if busy and idle_min < BUSY_GRACE_MIN:
        return "ok"
    if since_nudge_min is None:
        return "nudge" if idle_min >= NUDGE_AFTER_MIN else "ok"
    return "restart" if since_nudge_min >= RESTART_AFTER_NUDGE_MIN else "ok"


def sh(cmd, timeout=20):
    """Run a command; return (returncode, stdout, stderr). 127 = not installed, 124 = timed out."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GH_PROMPT_DISABLED="1")
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
    except FileNotFoundError:
        return 127, "", f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return 124, "", f"{cmd[0]} timed out"
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def short_error(text):
    text = re.sub(r"gh[pousr]_\w+|github_pat_\w+", "***", " ".join(text.split()))
    return "error: " + (text[:100] or "unknown")


def ci_state(rollup):
    """none | pending | failing | green, from a statusCheckRollup list."""
    if not rollup:
        return "none"
    pending = False
    for c in rollup:
        result = (c.get("conclusion") or c.get("state") or "").upper()
        if result in FAILED:
            return "failing"
        if c.get("status", "COMPLETED").upper() != "COMPLETED" or result not in PASSED:
            pending = True
    return "pending" if pending else "green"


def gh_json(path):
    """GET a REST path with `gh api` (GraphQL is blocked in a cloud session); return (data, error)."""
    rc, out, err = sh(["gh", "api", path])
    if rc:
        return None, err
    return json.loads(out or "null"), ""


def find_pr(repo, branch):
    owner = repo.split("/")[0]
    head = quote(f"{owner}:{branch}", safe="")
    rows, err = gh_json(f"repos/{repo}/pulls?head={head}&state=all&per_page=1")
    if err:
        return None, err
    return (rows[0]["number"] if rows else None), ""


def pr_rollup(repo, sha):
    """The PR head's check runs and commit statuses in one list that ci_state reads; REST only."""
    runs, err = gh_json(f"repos/{repo}/commits/{sha}/check-runs?per_page=100")
    if err:
        return None, err
    status, err = gh_json(f"repos/{repo}/commits/{sha}/status")
    if err:
        return None, err
    return list(runs.get("check_runs", [])) + list(status.get("statuses", [])), ""


def check_cloud(w):
    repo, branch = w["repo"], w["branch"]
    rc, out, err = sh(["gh", "api", f"repos/{repo}/git/ref/heads/{quote(branch, safe='/')}", "--jq", ".object.sha"])
    if rc and "404" not in err and "Not Found" not in err:
        return {"error": err}
    sha = out if not rc else None
    number = w.get("pr")
    if number is None:  # also when the branch is gone: it may have been deleted after its PR merged
        number, err = find_pr(repo, branch)
        if err:
            return {"error": err}
    pr = None
    if number is not None:
        d, err = gh_json(f"repos/{repo}/pulls/{number}")
        if err:
            return {"error": err}
        head = d["head"]["sha"]
        rollup, err = pr_rollup(repo, head)
        if err:
            return {"error": err}
        state = "merged" if d.get("merged") else d["state"].lower()
        pr = {"number": number, "state": state, "ci": ci_state(rollup), "head": head, "draft": bool(d.get("draft"))}
    if pr:
        sha7 = (pr["head"] or sha or "")[:7]
        state = "draft" if pr["state"] == "open" and pr["draft"] else pr["state"]
        signal = f"PR #{number} merged" if state == "merged" else f"PR #{number} {state} CI {pr['ci']} {sha7}"
        fp = "|".join([sha or "-", pr["head"] or "-", state, pr["ci"]])
        # Ready, not a draft: a worker opens its draft early and pushes every step, so CI can be green mid-work.
        # CI "none" counts, for repos with no checks; after this, CI results reach the orchestrator from Auto-fix.
        # Merged counts at the branch head, or once the branch is deleted: an old PR on a reused branch name does not.
        done = (state == "merged" and (sha is None or pr["head"] == sha)) or (
            state == "open" and pr["ci"] in ("green", "none") and pr["head"] == sha)
        ci_pending = state == "open" and pr["ci"] == "pending"  # open and not a draft
        pr = {k: pr[k] for k in ("number", "state", "ci")}
    else:
        signal = f"push {sha[:7]}" if sha else "no branch yet"
        fp, done, ci_pending = sha or "-", False, False
    return {"fp": fp, "signal": signal, "pr": pr, "done": done, "ci_pending": ci_pending}


def check_local(w):
    path = str(Path(w["path"]).expanduser())
    rc, head, err = sh(["git", "-C", path, "log", "-1", "--format=%H"])
    if rc:
        return {"error": err}
    rc, status, err = sh(["git", "-C", path, "status", "--porcelain"])
    if rc:
        return {"error": err}
    rc, diff, err = sh(["git", "-C", path, "diff", "HEAD", "--no-ext-diff"])
    if rc:
        return {"error": err}
    dirty = len(status.splitlines())
    signal = f"commit {head[:7]}" + (f" +{dirty} dirty" if dirty else "")
    fp = head + "|" + hashlib.sha1((status + "\0" + diff).encode()).hexdigest()
    return {"fp": fp, "signal": signal, "pr": None, "done": False}


def check_worker(w):
    try:
        return check_local(w) if "path" in w else check_cloud(w)
    except Exception as e:  # one bad worker must not stop the others
        return {"error": f"{type(e).__name__}: {e}"}


def judge(name, result, state, now, busy=False):
    """Fold one check into the worker's state; return the output row."""
    s = state.get(name)
    if s is None:
        s = state[name] = {"fp": None, "changed": now, "nudged_at": None}
    error = "error" in result
    if not error and result["fp"] != s["fp"]:
        s.update(fp=result["fp"], changed=now, nudged_at=None, done=False, done_seen=False, pending_since=None)
    idle = int((now - s["changed"]) // 60)
    throttled = error and bool(RATE_LIMIT.search(result["error"]))
    if throttled:
        s.setdefault("throttled_since", now)
        if s["throttled_since"] is None:
            s["throttled_since"] = now
    else:
        s["throttled_since"] = None  # a good read, or another error, ends the run of throttled reads
    # Ready PR, CI still running: the worker stopped correctly. Grace from when CI first showed pending.
    pending = not error and bool(result.get("ci_pending"))
    if pending and s.get("pending_since") is None:
        s["pending_since"] = now
    if not pending:
        s["pending_since"] = None
    ci_wait = pending and now - s["pending_since"] < CI_PENDING_GRACE_MIN * 60
    rate_limited = throttled and now - s["throttled_since"] >= THROTTLE_ERROR_AFTER_MIN * 60
    if throttled and not s.get("done") and not rate_limited:
        v = "ok"  # GitHub throttled the read: no data, not no progress, for up to 10 minutes
    elif ci_wait:
        v = "ok"
    elif error and s.get("done"):
        v = "done"  # a finished worker stays finished through a failed read; new work clears it
    elif error and s.get("done_seen"):
        v = "ok"  # seen done once: a failed read on the confirming check waits for the next one
    elif not error and result["done"]:
        # Done on two ticks in a row: right after a push, checks can take seconds to register.
        v = "done" if s.get("done_seen") else "ok"
        s.update(done_seen=True, done=v == "done")
    else:
        nudged_at = s.get("nudged_at")
        v = verdict(idle, None if nudged_at is None else int((now - nudged_at) // 60), busy)
        if v == "nudge":
            s["nudged_at"] = now
    signal = result.get("signal")
    if error:
        signal = "rate limited" if rate_limited else short_error(result["error"])
    elif ci_wait:
        signal = "ci pending"
    return {"name": name, "signal": signal, "idle_min": idle, "pr": None if error else result["pr"], "verdict": v}


def check_all(workers):
    with ThreadPoolExecutor(max_workers=min(8, len(workers)) or 1) as pool:
        return list(pool.map(check_worker, workers))


class locked_state:
    """Read, change and write the state file under a lock, so a tick never undoes a --reset made meanwhile."""

    def __init__(self, path):
        self.path = path

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:  # never follow a symlink, so a planted link cannot redirect the lock; 0600, as only this user reads it
            fd = os.open(str(self.path) + ".lock", os.O_WRONLY | os.O_CREAT | os.O_APPEND | NOFOLLOW, 0o600)
        except OSError as e:
            sys.exit(f"watch_workers: cannot open {self.path}.lock ({errno.errorcode.get(e.errno, e.errno)}); refusing a symlink")
        self.lock = os.fdopen(fd, "a")
        if fcntl:
            fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.state = load_state(self.path)
        return self.state

    def __exit__(self, kind, *_):
        try:
            if kind is None:
                save_state(self.path, self.state)
        finally:
            self.lock.close()


def load_state(path):
    try:
        fd = os.open(path, os.O_RDONLY | NOFOLLOW)
        with os.fdopen(fd) as f:
            state = json.loads(f.read())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        print(f"watch_workers: state file {path} unreadable ({type(e).__name__}); starting fresh", file=sys.stderr)
        return {}
    ok = isinstance(state, dict) and all(
        isinstance(v, dict) and ({"started"} <= v.keys() if k == "_watch" else {"fp", "changed"} <= v.keys())
        for k, v in state.items())
    if not ok:
        print(f"watch_workers: state file {path} has the wrong shape; starting fresh", file=sys.stderr)
        return {}
    return state


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".")
    with os.fdopen(fd, "w") as f:
        json.dump(state, f)
    os.replace(tmp, path)


def load_workers(path):
    workers = json.loads(Path(path).expanduser().read_text())
    if len(workers) > MAX_WORKERS:
        print(f"watch_workers: {len(workers)} workers; the most is {MAX_WORKERS}. Split the plan or watch fewer: each cloud "
              "worker costs up to 5 `gh api` calls a minute against the account's shared 5,000/hr limit.", file=sys.stderr)
        sys.exit(2)
    names = [w["name"] for w in workers]
    if "_watch" in names:
        sys.exit("worker name _watch is reserved")
    if len(set(names)) != len(names):
        sys.exit("worker names must be unique")
    for w in workers:
        if "path" not in w and not ("repo" in w and "branch" in w):
            sys.exit(f"worker {w['name']}: needs repo + branch, or path")
    return workers


def default_state(workers_path):
    key = hashlib.sha1(str(Path(workers_path).expanduser().resolve()).encode()).hexdigest()[:12]
    return Path(tempfile.gettempdir()) / f"watch_workers.{key}.state.json"


def emit(row):
    print(json.dumps(row, separators=(",", ":")), flush=True)


def main():
    ap = argparse.ArgumentParser(description="Check workers and say which stalled.")
    ap.add_argument("--workers", help="JSON file listing the workers")
    ap.add_argument("--state", help="state file (default: one per workers file, in $TMPDIR)")
    ap.add_argument("--once", action="store_true", help="check once, print one JSON line per worker")
    ap.add_argument("--every", type=float, default=60, help="seconds between checks in loop mode")
    ap.add_argument("--max-minutes", type=float, default=120, metavar="N",
                    help="loop mode exits with the last results after N minutes (default 120)")
    ap.add_argument("--reset", action="append", metavar="NAME", help="clear this worker's state and exit")
    ap.add_argument("--now", type=float, help="fake clock (epoch seconds), for tests")
    ap.add_argument("--busy", action="append", default=[], metavar="NAME",
                    help="a worker the session list shows busy right now (repeatable)")
    args = ap.parse_args()
    if not args.workers and not args.state:
        ap.error("--workers is required")
    state_path = Path(args.state).expanduser() if args.state else default_state(args.workers)

    if args.reset:
        with locked_state(state_path) as state:
            for name in args.reset:
                state.pop(name, None)
        print("reset " + ", ".join(args.reset))
        return
    if not args.workers:
        ap.error("--workers is required")
    workers = load_workers(args.workers)

    last = {}
    rows_by_name = {}
    while True:
        # A worker already done is not read again in a loop: one `done` stays done.
        todo = [w for w in workers if args.once or rows_by_name.get(w["name"], {}).get("verdict") != "done"]
        results = check_all(todo)
        now = args.now if args.now is not None else time.time()
        with locked_state(state_path) as state:
            # The watch's start is set once and kept across runs (Monitor restarts the script), so the cap holds.
            started = state.setdefault("_watch", {"started": now})["started"]
            for w, r in zip(todo, results):
                rows_by_name[w["name"]] = judge(w["name"], r, state, now, w["name"] in args.busy)
        rows = [rows_by_name[w["name"]] for w in workers]
        printed = set()
        for row in rows:
            key = (row["verdict"], row["signal"])
            if args.once or last.get(row["name"]) != key:
                emit(row)
                printed.add(row["name"])
            last[row["name"]] = key
        if args.once or all(r["verdict"] == "done" for r in rows):
            return
        left = args.max_minutes * 60 - (now - started)
        if left <= 0:
            for row in rows:  # out of time: leave with each worker's last row
                if row["name"] not in printed and row["verdict"] != "done":  # a done row was printed already
                    emit(row)
            return
        time.sleep(min(args.every, left))


if __name__ == "__main__":
    main()
