# Claudius

The Claude pack for [Git Crafter](https://github.com/SoulCraft-Org/git-crafter): Quality tabs and Process maps that score a repo's Claude Code setup.

Claudius is not an Anthropic product and is not affiliated with Anthropic.

## What it is

| Part | Is |
| --- | --- |
| Pack | 6 tabs: Claude, Claude settings, Claude desktop app, Blockers, Tokens, Instructions. Maps: Guard, Decide |
| Engine | Git Crafter's `actions/pages` and CI standard, pinned by full commit SHA. No engine code lives here |
| Public pages | Built in CI from `quality/public/`. The Quality page shows only metrics read from GitHub and the repo's files; each metric that needs local files is dropped: not shown, counted or listed. The Process page shows each map step such a metric does not score |
| Private numbers | Usage, cost, transcripts and connectors. Read on your own machine only, never uploaded |
| Licence | Apache-2.0. Source of the moved files: [NOTICE](NOTICE) |

## Layout

| Path | Holds |
| --- | --- |
| `pack.json` | the six tabs |
| `targets/`, `ideals/`, `maps/` | metric definitions, ideal states, the Guard and Decide maps |
| `collectors/<tab>/`, `fixtures/` | the collectors, their tests and test fixtures |
| `quality/process/config.json` | the Process page: the Guard and Decide maps, named by `use` |
| `quality/public.mjs` | writes `quality/public/`: the configs CI builds the public pages from, each metric that needs local files dropped, each map written out in full without the steps those metrics score |
| `tests/moved.json` | where each file came from in Git Crafter |
| `tests/engine-tests.sh` | CI: each file matches its source or is listed as edited, then the tests run beside the pinned engine |

## Add the pack

| Step | Do |
| --- | --- |
| 1 | Adopt Git Crafter: its `templates/ci/README.md` |
| 2 | In `quality/config.json`, add `"packs": ["Colorado-Startups/claudius@<40-hex sha>"]` |
| 3 | `actions/pages` checks the pack out at that SHA and runs its collectors |
| 4 | A `--local` run reads the pack from `$CODE_OS_PACKS/Colorado-Startups/claudius`, default `.code-os-packs/` in the repo, with no SHA folder (Git Crafter `quality/packs.mjs`) |

| Pin | Works |
| --- | --- |
| Git Crafter engine up to `d3c15df` (v4.6.4) | No. That engine still ships these tabs, and a pack named like them is a usage error |
| Git Crafter engine from `70ccd19` (v5.0.0), which ships no Claude tab | Yes: the collectors take every engine helper from `lib` (`collectors/lib/engine.mjs`). This repo pins `a9d6b45` (v7.0.0) |

## The one local command

| Command | Writes | Uploaded |
| --- | --- | --- |
| `node <git-crafter>/quality/collect.mjs --config quality/config.json --local` | `quality/data/local.json` and `quality/history/`, both in `.gitignore`: the full page, every metric | Never |

## Privacy gate

| Check | Fails when |
| --- | --- |
| [tests/privacy.mjs](tests/privacy.mjs), on every page build | the run is not a CI run, a local-only metric is in it, read or not, or a local-only id, home path, email or listed name is in it or in any file the deploy uploads (quality/public/dist) |
| Names | `PRIVACY_NAMES`, comma separated: the repo's Actions secret in CI, an environment variable on your machine. A finding prints its file and line, never what it matched. With none set, as on a fork's pull request, the name check is skipped and the gate says so |

| Process map | Public steps | Why |
| --- | --- | --- |
| Guard | `change` only | its other four steps read local-only metrics |
| Decide | none, so the public page leaves it out | all four steps read local-only metrics |
