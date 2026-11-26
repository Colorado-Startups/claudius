// node --test tests/watch.test.mjs
// The plan skill's watcher (plugin/skills/plan/scripts/watch_workers.py), with its fake clock (--now). Local
// worktrees run on a temporary git repo; cloud workers run against a fake `gh` first on PATH. No network.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../plugin/skills/plan/scripts/watch_workers.py', import.meta.url));
const T0 = 1_800_000_000;
const SHA = 'a'.repeat(40);

// Runs the script; returns its JSON lines.
function watch(args, env = {}) {
  const r = spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => (l.startsWith('{') ? JSON.parse(l) : l));
}

// A fresh repo with one committed file, its workers file and its own state file.
function local(name = 'w') {
  const dir = mkdtempSync(join(tmpdir(), 'watch-'));
  const repo = join(dir, 'repo');
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=watch', '-c', 'user.email=watch', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q', repo);
  writeFileSync(join(repo, 'f.txt'), 'one');
  git('-C', repo, 'add', 'f.txt');
  git('-C', repo, 'commit', '-q', '-m', 'one');
  const workers = join(dir, 'workers.json');
  writeFileSync(workers, JSON.stringify([{ name, path: repo }]));
  const state = join(dir, 'state.json');
  const run = (now, ...extra) => watch(['--workers', workers, '--state', state, '--once', '--now', String(now), ...extra])[0];
  return { dir, repo, git, run, workers, state };
}

// A cloud worker read through a fake gh that answers with the PR this test sets.
function cloud(pr, runs = [{ status: 'completed', conclusion: 'success' }]) {
  const dir = mkdtempSync(join(tmpdir(), 'watch-gh-'));
  writeFileSync(join(dir, 'gh'), [
    '#!/bin/sh',
    '[ -n "$FAKE_LOG" ] && echo "$*" >> "$FAKE_LOG"',
    '[ -n "$FAKE_FAIL" ] && { echo "${FAKE_ERR:-gh: connection refused}" >&2; exit 1; }',
    'case "$2" in',
    '  */git/ref/*) [ -n "$FAKE_NOBRANCH" ] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }; echo "$FAKE_SHA" ;;',
    '  */pulls?head=*) echo "$FAKE_PULLS" ;;',
    '  */pulls/*) echo "$FAKE_PR" ;;',
    '  */check-runs*) echo "$FAKE_RUNS" ;;',
    '  */status) echo "$FAKE_STATUS" ;;',
    '  *) echo "unexpected: $*" >&2; exit 1 ;;',
    'esac',
  ].join('\n'));
  chmodSync(join(dir, 'gh'), 0o755);
  const workers = join(dir, 'workers.json');
  writeFileSync(workers, JSON.stringify([{ name: 'c', repo: 'owner/repo', branch: 'claude/c' }]));
  const env = { PATH: `${dir}:${process.env.PATH}`, FAKE_SHA: SHA, FAKE_PULLS: '[{"number":7}]', FAKE_PR: JSON.stringify(pr), FAKE_RUNS: JSON.stringify({ check_runs: runs }), FAKE_STATUS: JSON.stringify({ statuses: [] }) };
  const state = join(dir, 'state.json');
  const run = (now, ...extra) => watch(['--workers', workers, '--state', state, '--now', String(now), ...extra], env);
  const runEnv = (now, extra) => watch(['--workers', workers, '--state', state, '--now', String(now), '--once'], { ...env, ...extra });
  const fail = (now) => runEnv(now, { FAKE_FAIL: '1' });
  return { run, fail, runEnv, env, workers, state };
}
// The REST shape of GET repos/<repo>/pulls/<n>; the check runs are the second argument of cloud().
const pr = (over) => ({ state: 'open', merged: false, draft: false, head: { sha: SHA }, ...over });

test('watch: a quiet minute is a nudge, a second minute after it is a restart', () => {
  const { run } = local();
  const first = run(T0);
  assert.equal(first.verdict, 'ok');
  assert.match(first.signal, /^commit [0-9a-f]{7}$/);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  assert.equal(run(T0 + 90).verdict, 'ok');
  assert.equal(run(T0 + 120).verdict, 'restart');
});

test('watch: a commit, a new edit and a second edit to a dirty file are each progress', () => {
  const { repo, git, run } = local();
  run(T0);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  git('-C', repo, 'commit', '-q', '--allow-empty', '-m', 'two');
  assert.deepEqual([run(T0 + 70).verdict, run(T0 + 70).idle_min], ['ok', 0]);
  writeFileSync(join(repo, 'f.txt'), 'two');
  const dirty = run(T0 + 200);
  assert.equal(dirty.idle_min, 0);
  assert.match(dirty.signal, /\+1 dirty$/);
  writeFileSync(join(repo, 'f.txt'), 'three');
  assert.equal(run(T0 + 330).idle_min, 0);
});

test('watch: a worker shown busy gets 10 minutes before a nudge', () => {
  const { run } = local();
  run(T0);
  assert.equal(run(T0 + 9 * 60, '--busy', 'w').verdict, 'ok');
  assert.equal(run(T0 + 10 * 60, '--busy', 'w').verdict, 'nudge');
});

test('watch: --reset forgets a worker, so a restarted one starts from zero', () => {
  const { run, workers, state } = local();
  run(T0);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  assert.deepEqual(watch(['--workers', workers, '--state', state, '--reset', 'w']), ['reset w']);
  assert.deepEqual([run(T0 + 61).verdict, run(T0 + 61).idle_min], ['ok', 0]);
});

test('watch: a worker that cannot be read is no progress, so it is nudged and then restarted', () => {
  const { dir, run, workers } = local();
  writeFileSync(workers, JSON.stringify([{ name: 'gone', path: join(dir, 'missing') }]));
  assert.equal(run(T0).verdict, 'ok');
  const later = run(T0 + 60);
  assert.equal(later.verdict, 'nudge');
  assert.match(later.signal, /^error: /);
  assert.equal(run(T0 + 120).verdict, 'restart');
});

test('watch: without --state, each workers file gets its own state', () => {
  const a = local('w');
  const b = local('w');
  const env = { TMPDIR: a.dir };
  watch(['--workers', a.workers, '--once', '--now', String(T0)], env);
  watch(['--workers', b.workers, '--once', '--now', String(T0)], env);
  assert.equal(readdirSync(a.dir).filter((f) => /^watch_workers\.[0-9a-f]{12}\.state\.json$/.test(f)).length, 2);
});

test('watch: a draft PR is never done, even with green CI', () => {
  const { run } = cloud(pr({ draft: true }));
  const [row] = run(T0, '--once');
  assert.equal(row.verdict, 'ok');
  assert.match(row.signal, /^PR #7 draft CI green/);
  assert.equal(run(T0 + 60, '--once')[0].verdict, 'nudge');
});

// Done is confirmed on a second check, a minute later.
const doneAfterTwo = (p, runs) => {
  const { run } = cloud(p, runs);
  assert.equal(run(T0, '--once')[0].verdict, 'ok');
  return run(T0 + 60, '--once')[0];
};

test('watch: a ready PR at the branch head with green or no CI is done on the second check, and loop mode exits', () => {
  assert.equal(doneAfterTwo(pr({})).verdict, 'done');
  assert.equal(doneAfterTwo(pr({}), []).verdict, 'done');
  const merged = doneAfterTwo(pr({ state: 'closed', merged: true }));
  assert.deepEqual([merged.verdict, merged.signal], ['done', 'PR #7 merged']);
  const rows = cloud(pr({})).run(T0, '--every', '0');
  assert.deepEqual(rows.map((r) => r.verdict), ['ok', 'done']);
});

test('watch: an old merged PR on a reused branch name is not done', () => {
  assert.notEqual(doneAfterTwo(pr({ state: 'closed', merged: true, head: { sha: 'b'.repeat(40) } })).verdict, 'done');
});

test('watch: a done worker stays done through a failed read, and is not nudged', () => {
  const { run, fail } = cloud(pr({}));
  run(T0, '--once');
  assert.equal(run(T0 + 60, '--once')[0].verdict, 'done');
  for (const t of [T0 + 120, T0 + 180, T0 + 240]) assert.equal(fail(t)[0].verdict, 'done');
});

test('watch: a failed read on the confirming check waits; new work clears done', () => {
  const { run, fail, runEnv } = cloud(pr({}));
  assert.equal(run(T0, '--once')[0].verdict, 'ok');
  assert.equal(fail(T0 + 60)[0].verdict, 'ok');
  assert.equal(run(T0 + 120, '--once')[0].verdict, 'done');
  const moved = runEnv(T0 + 180, { FAKE_SHA: 'c'.repeat(40) })[0];
  assert.equal(moved.verdict, 'ok');
  assert.equal(moved.idle_min, 0);
});

test('watch: a merged PR whose branch was deleted is done', () => {
  const { runEnv } = cloud(pr({ state: 'closed', merged: true }));
  assert.equal(runEnv(T0, { FAKE_NOBRANCH: '1' })[0].verdict, 'ok');
  assert.equal(runEnv(T0 + 60, { FAKE_NOBRANCH: '1' })[0].verdict, 'done');
});

test('watch: a corrupt state file says so and starts fresh', () => {
  const { run, state, workers } = local();
  writeFileSync(state, '{not json');
  const r = spawnSync('python3', ['-I', SCRIPT, '--workers', workers, '--state', state, '--once', '--now', String(T0)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /unreadable/);
  assert.equal(run(T0 + 60).verdict, 'nudge');
});

test('watch: CI failing or pending, or a PR behind the branch, is not done', () => {
  assert.match(cloud(pr({}), [{ status: 'completed', conclusion: 'failure' }]).run(T0, '--once')[0].signal, /CI failing/);
  assert.equal(cloud(pr({}), [{ status: 'in_progress', conclusion: null }]).run(T0, '--once')[0].verdict, 'ok');
  assert.equal(cloud(pr({ head: { sha: 'b'.repeat(40) } })).run(T0, '--once')[0].verdict, 'ok');
});

const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean);

test('watch: a commit status that is pending or failed counts in the CI rollup', () => {
  const c = cloud(pr({}));
  const status = (state) => ({ FAKE_STATUS: JSON.stringify({ statuses: [{ state }] }) });
  assert.equal(c.runEnv(T0, status('pending'))[0].pr.ci, 'pending');
  assert.match(c.runEnv(T0 + 1, status('failure'))[0].signal, /CI failing/);
  assert.match(c.runEnv(T0 + 2, status('success'))[0].signal, /CI green/);
});

test('watch: a branch with no PR reads as a push, and the PR lookup passes head=owner:branch', () => {
  const log = join(mkdtempSync(join(tmpdir(), 'watch-log-')), 'gh.log');
  const [row] = cloud(pr({})).runEnv(T0, { FAKE_PULLS: '[]', FAKE_LOG: log });
  assert.deepEqual([row.verdict, row.pr, row.signal], ['ok', null, `push ${SHA.slice(0, 7)}`]);
  assert.ok(lines(log).some((l) => l.includes('repos/owner/repo/pulls?head=owner%3Aclaude%2Fc&state=all')), lines(log).join('\n'));
});

test('watch: a rate-limit error is no data (ok), while another error is still no progress', () => {
  const { runEnv } = cloud(pr({}));
  const limited = { FAKE_FAIL: '1', FAKE_ERR: 'gh: API rate limit exceeded (HTTP 403)' };
  assert.equal(runEnv(T0, limited)[0].verdict, 'ok');
  const later = runEnv(T0 + 120, limited)[0];
  assert.equal(later.verdict, 'ok');
  assert.match(later.signal, /rate limit/);
  assert.equal(runEnv(T0 + 180, { FAKE_FAIL: '1' })[0].verdict, 'nudge');
});

test('watch: loop mode exits at --max-minutes with the last row', () => {
  const { dir, workers, state } = local();
  const rows = watch(['--workers', workers, '--state', state, '--now', String(T0), '--every', '0', '--max-minutes', '0']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, 'ok');
  assert.ok(dir);
});

test('watch: loop mode does not read a done worker again', () => {
  const log = join(mkdtempSync(join(tmpdir(), 'watch-log-')), 'gh.log');
  const c = cloud(pr({}));
  const l = local();
  writeFileSync(c.workers, JSON.stringify([
    { name: 'c', repo: 'owner/repo', branch: 'claude/c' },
    { name: 'w', path: l.repo },
  ]));
  const rows = watch(['--workers', c.workers, '--state', c.state, '--every', '0', '--max-minutes', '0.03'],
    { ...c.env, FAKE_LOG: log });
  assert.deepEqual(rows.filter((r) => r.name === 'c').map((r) => r.verdict), ['ok', 'done']);
  assert.equal(lines(log).filter((x) => x.includes('/git/ref/')).length, 2);
});

test('watch: a symlinked lock file is refused, and the state file is private', () => {
  const { dir, workers, state } = local();
  symlinkSync(join(dir, 'elsewhere'), state + '.lock');
  const r = spawnSync('python3', ['-I', SCRIPT, '--workers', workers, '--state', state, '--once'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /symlink/);
  const ok = local();
  ok.run(T0);
  assert.equal(statSync(ok.state).mode & 0o077, 0);
  assert.equal(statSync(ok.state + '.lock').mode & 0o077, 0);
});

test('watch: --max-minutes counts from the first check, across runs', () => {
  const { workers, state, run } = local();
  run(T0); // the first run sets the start
  const args = ['--workers', workers, '--state', state, '--every', '0', '--max-minutes', '1'];
  // A restarted loop one hour later is already past the cap: it prints once and exits.
  assert.equal(watch([...args, '--now', String(T0 + 3600)]).length, 1);
});

test('watch: throttled reads are ok for 10 minutes in a row, then an error that is nudged; a good read resets', () => {
  const { runEnv } = cloud(pr({}));
  const limited = { FAKE_FAIL: '1', FAKE_ERR: 'gh: API rate limit exceeded (HTTP 403)' };
  assert.equal(runEnv(T0, limited)[0].verdict, 'ok');
  assert.equal(runEnv(T0 + 540, limited)[0].verdict, 'ok');
  const dead = runEnv(T0 + 600, limited)[0];
  assert.deepEqual([dead.verdict, dead.signal], ['nudge', 'rate limited']);
  runEnv(T0 + 700, {}); // a good read ends the run of throttled reads
  assert.equal(runEnv(T0 + 710, limited)[0].verdict, 'ok');
  assert.equal(runEnv(T0 + 1290, limited)[0].verdict, 'ok');
  assert.equal(runEnv(T0 + 1310, limited)[0].signal, 'rate limited');
});

test('watch: a ready PR with CI pending is ok for 20 minutes, then quiet again; a draft is not given the grace', () => {
  const pend = { FAKE_RUNS: JSON.stringify({ check_runs: [{ status: 'in_progress', conclusion: null }] }) };
  const { runEnv } = cloud(pr({}));
  const first = runEnv(T0, pend)[0];
  assert.deepEqual([first.verdict, first.signal], ['ok', 'ci pending']);
  assert.equal(runEnv(T0 + 19 * 60, pend)[0].verdict, 'ok');
  assert.equal(runEnv(T0 + 20 * 60, pend)[0].verdict, 'nudge');
  const draft = cloud(pr({ draft: true }));
  draft.runEnv(T0, pend);
  assert.equal(draft.runEnv(T0 + 60, pend)[0].verdict, 'nudge');
});

test('watch: more than 8 workers is refused with exit 2', () => {
  const { dir, state } = local();
  const file = join(dir, 'many.json');
  writeFileSync(file, JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ name: `w${i}`, path: dir }))));
  const r = spawnSync('python3', ['-I', SCRIPT, '--workers', file, '--state', state, '--once'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /split the plan or watch fewer/i);
});

test('watch: a different workers list on the same state starts a new watch', () => {
  const { repo, workers, state, run } = local();
  const hourAgo = Math.floor(Date.now() / 1000) - 3600;
  run(hourAgo); // an old watch with the first list
  writeFileSync(workers, JSON.stringify([{ name: 'other', path: repo }]));
  const t = Date.now();
  watch(['--workers', workers, '--state', state, '--every', '0.2', '--max-minutes', '0.03']);
  assert.ok(Date.now() - t >= 1000, 'the loop ran past its first check');
  const saved = JSON.parse(readFileSync(state, 'utf8'));
  assert.ok(saved._watch.started > hourAgo + 3000);
  assert.equal(saved.w, undefined);
});

test('watch: --once past --max-minutes prints the over line and exits 3', () => {
  const { workers, state, run } = local();
  run(T0);
  const r = spawnSync('python3', ['-I', SCRIPT, '--workers', workers, '--state', state, '--once', '--now', String(T0 + 3600), '--max-minutes', '1'], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  const out = r.stdout.trim().split('\n');
  assert.deepEqual(JSON.parse(out[out.length - 1]), { watch: 'over', max_minutes: 1 });
  assert.equal(out.length, 2);
});
