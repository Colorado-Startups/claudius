# Claudius

The Claude pack for [Git Crafter](https://github.com/SoulCraft-Org/git-crafter): Claude Code templates, Quality tabs and Process maps for a GitHub repo that agents drive from the Claude desktop app.

Brand: [Colorado Startups brand guide](https://colorado-startups.github.io/brand/)

[Live Quality and Process pages](https://colorado-startups.github.io/claudius/)

| 🧩 With Claudius | ⬜ Without | 📈 Lift | 🪙 Always-on tokens |
|---|---|---|---|
| **63%** of graded tasks passed | 11% | **+52 points**, ± 12 at 95% | 404 |

[Scorecard](SCORECARD.md): 18 tasks on three models, measured 2026-11-15; `plan` re-measured and `visibility` measured 2026-11-19 at plugin 0.4.1.

| [Best practices tab](https://colorado-startups.github.io/claudius/#practices): 10 of 10 at goal | [Publish map](https://colorado-startups.github.io/claudius/process.html#map-publish): 6 of 6 steps |
|---|---|
| ![Best practices tab: quality, speed and consumption all 100](docs/best-practices-tab.jpg) | ![Publish map: Write, Trim, Test, Measure, Validate, Clear, all at goal](docs/publish-map.jpg) |

Live page, 2026-11-15, commit 116d655.

Claudius is not an Anthropic product and is not affiliated with Anthropic.

## Quickstart: 3 steps

`../claudius` and `../git-crafter` are clones beside your repo.

| # | Do | Where |
|---|---|---|
| 1 | Adopt Git Crafter: CI, open-repo files, `AGENTS.md` and `CLAUDE.md` | Git Crafter's [quickstart](https://github.com/SoulCraft-Org/git-crafter#quickstart-3-steps) |
| 2 | Copy the Claude files, and keep every plugin, skill and connector on ([All on, app-wide](templates/claude/README.md#all-on-app-wide)) | `cp -r ../claudius/templates/claude/.claude .` |
| 3 | Run the script below. It pins the latest release, adds the pack's tab ids when `quality/config.json` lists `tabs`, and draws the full page locally ([the command](#the-one-local-command)) | your repo's root |

```bash
U=https://github.com/Colorado-Startups/claudius
TAG=$(git ls-remote --tags --refs --sort=-v:refname $U 'v*' | head -1 | cut -d/ -f3)
SHA=$(git ls-remote $U "refs/tags/$TAG" "refs/tags/$TAG^{}" | tail -1 | cut -f1)
curl -fsS https://raw.githubusercontent.com/Colorado-Startups/claudius/$SHA/pack.json -o /tmp/pack.json
node -e '
const fs = require("fs"), c = JSON.parse(fs.readFileSync("quality/config.json"));
const ids = JSON.parse(fs.readFileSync("/tmp/pack.json")).tabs.map((t) => (Array.isArray(t) ? t[0] : t.id ?? t));
const own = "Colorado-Startups/claudius@";
c.packs = [...(c.packs ?? []).filter((p) => !String(p).startsWith(own)), own + process.argv[1]];
if (Array.isArray(c.tabs)) c.tabs = [...new Set([...c.tabs, ...ids])];
fs.writeFileSync("quality/config.json", JSON.stringify(c, null, 2) + "\n");' $SHA
P=.code-os-packs/Colorado-Startups/claudius
[ -d $P ] || git clone -q $U $P
git -C $P fetch -q --tags && git -C $P checkout -q $SHA
for l in .code-os-packs/ quality/data/ quality/history/; do grep -qxF $l .gitignore 2>/dev/null || echo $l >> .gitignore; done
node ../git-crafter/quality/collect.mjs --config quality/config.json --local
```

Then, each optional:

| Add | Do |
|---|---|
| Process maps | Add `{ "use": "<id>" }` to your Process config's `maps` for each map you want, one per file in [`maps/`](maps/). This repo's own [`quality/process/config.json`](quality/process/config.json) names every one ([maps/README.md](maps/README.md)) |
| Code Project | Attach the repo to a project and paste the [setup prompt](docs/projects-quickstart.md#setup-prompt) as its first message: [3 steps](docs/projects-quickstart.md). Its [Quality, Speed and Consumption pages](templates/claude/code-project/README.md#pages) score each Project tab |

The pin, the tab ids and the Pages setup in detail: [Add the pack](#add-the-pack).

## Build an app

```mermaid
flowchart LR
  O[Outline] --> Q[Up to 4 vision questions] --> A[Plan Artifact] --> OK[Approve]
  OK --> S[One session per step] --> PR[PR in one push] --> R[Review and merge] --> L[Live]
  R -. BLOCK .-> S
```

| Owner | Claude |
|---|---|
| Outlines the app in a Code tab session, answers up to 4 questions, approves the plan | The rest, by the Claudius plugin's `plan` skill ([plugin/](plugin/README.md)) |

## What it is

| Part | Is |
| --- | --- |
| Templates | `templates/claude/`: the Claude-only files a repo commits. This repo runs copies of them (`tests/templates.test.mjs`) |
| Plugin | `plugin/`: the `claudius` Claude Code plugin (skills `plan`, `merge`, `equip`, `find-plugin`, `plain-voice`, `visibility`). Install: `claude plugin marketplace add Colorado-Startups/claudius`, then `claude plugin install claudius@claudius` |
| Pack | 9 tabs: Claude, Claude settings, Claude desktop app, Blockers, Tokens, Instructions, Best practices, Visibility, Code Project. Maps: Guard, Decide, Equip, Publish, Visibility, Project, Ship, Environment, Remember |
| Engine | Git Crafter's `actions/pages` and CI standard, pinned by full commit SHA. No engine code lives here |
| Public pages | Built in CI from `quality/public/`. The Quality page shows only metrics read from GitHub and the repo's files. Each metric that needs local files is dropped: not shown, counted or listed. The exceptions are the ones `quality/public-params.json` reads from committed files alone. A tab left with no metric, Tokens and Claude desktop app, is left off; it shows on a `--local` page (Git Crafter v7.0.1 or later). The Process page shows each map step such a metric does not score |
| Private numbers | Usage, cost, transcripts and connectors. Read on your own machine only, never uploaded |
| Licence | Apache-2.0. Source of the moved files: [NOTICE](NOTICE) |

## Layout

| Path | Holds |
| --- | --- |
| `templates/claude/` | the Claude templates; `AGENTS.md`, `CLAUDE.md` and `.claude/` at the root are this repo's own |
| `pack.json` | the nine tabs |
| `targets/`, `ideals/`, `maps/` | metric definitions, ideal states, the Guard, Decide, Equip, Publish, Visibility, Project, Ship, Environment and Remember maps |
| `collectors/<tab>/`, `fixtures/` | the collectors, their tests and test fixtures |
| `quality/process/config.json` | the Process page: the Guard, Decide, Equip, Publish, Visibility, Project, Ship, Environment and Remember maps, named by `use` |
| `quality/public.mjs`, `quality/public-params.json` | write `quality/public/`, the configs CI builds the public pages from. Each metric that needs local files is dropped but the repo-file ones. Each map is written out in full without the steps those metrics score |
| `tests/moved.json` | where each file came from in Git Crafter |
| `tests/engine-tests.sh` | CI: each file matches its source or is listed as edited, then the tests run beside the pinned engine |

## Add the pack

| Step | Do |
| --- | --- |
| 1 | Adopt Git Crafter: its `templates/ci/README.md` |
| 2 | In `quality/config.json`, add `"packs": ["Colorado-Startups/claudius@<40-hex sha>"]`, the commit of the latest [release](https://github.com/Colorado-Startups/claudius/releases) |
| 3 | If `quality/config.json` lists `tabs`, add the pack's ids too (`claude`, `claude-settings`, `desktop-app`, `blockers`, `tokens`, `instructions`, `practices`): a pack's tabs join only the default list (Git Crafter `quality/CONFIG.md`) |
| 4 | Pass that same file as `actions/pages`' `quality-config`, and name it as the Process config's `quality_config`: only that file's packs are fetched, so a map from the pack is found there alone |
| 5 | `actions/pages` checks the pack out at that SHA and runs its collectors |
| 6 | For a `--local` run, clone the pack at that SHA into `$CODE_OS_PACKS/Colorado-Startups/claudius` (default `.code-os-packs/` in the repo), with no SHA folder (Git Crafter `quality/packs.mjs`) |
| 7 | Moving the pins later: the `bump-pins` skill in `templates/claude/` |

| Pin | Works |
| --- | --- |
| Git Crafter engine up to `d3c15df` (v4.6.4) | No. That engine still ships these tabs, and a pack named like them is a usage error |
| Git Crafter engine from `70ccd19` (v5.0.0), which ships no Claude tab | Yes: the collectors take every engine helper from `lib` (`collectors/lib/engine.mjs`). This repo pins `8023bd4` (v7.0.2) |

## The one local command

| Command | Writes | Uploaded |
| --- | --- | --- |
| First, by hand in a desktop app session (no code writes it): call `get_usage` and save its `plan` block with a `read_at` added, `{"read_at": "<ISO time>", "windows": [{"label", "percentUsed", "resetsAt"}, …]}`, to `quality/data/plan-usage.json` | the plan windows `tokens.plan_used` reads; older than a day, not measured | Never |
| `node <git-crafter>/quality/collect.mjs --config quality/config.json --local` | `quality/data/local.json` and `quality/history/`, both in `.gitignore`: the full page, every metric | Never |

## Privacy gate

| Check | Fails when |
| --- | --- |
| [tests/privacy.mjs](tests/privacy.mjs), on every page build | the run is not a CI run, or a local-only metric is in it, read or not. Or a local-only id, home path, email or listed name is in it, or in any file the deploy uploads (quality/public/dist) |
| Names | `PRIVACY_NAMES`, comma separated: the repo's Actions secret in CI, an environment variable on your machine. A finding prints its file and line, never what it matched. With none set, as on a fork's pull request, the name check is skipped and the gate says so |

| Process map | Public steps | Why |
| --- | --- | --- |
| Guard | `change` | its other three steps read local-only metrics |
| Decide | none, so the public page leaves it out | all five steps read local-only metrics |
| Equip | none, so the public page leaves it out | all six steps read local-only metrics |
| Publish | all six | every step reads the repo's committed files |
| Visibility | all five | every step reads GitHub; two need a token with admin reads and read not measured without one |
