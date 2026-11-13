# Claudius

The Claude pack for [Git Crafter](https://github.com/SoulCraft-Org/git-crafter): Quality tabs and Process maps that score a repo's Claude Code setup.

Claudius is not an Anthropic product and is not affiliated with Anthropic.

## What it is

| Part | Is |
| --- | --- |
| Pack | 6 tabs: Claude, Claude settings, Claude desktop app, Blockers, Tokens, Instructions. Maps: Guard, Decide |
| Engine | Git Crafter's `actions/pages` and CI standard, pinned by full commit SHA. No engine code lives here |
| Public page | Built in CI from this repo. It shows only metrics read from GitHub and the repo's files |
| Private numbers | Usage, cost, transcripts and connectors. Read on your own machine only, never uploaded |
| Licence | Apache-2.0. Source of the moved files: [NOTICE](NOTICE) |

## Layout

| Path | Holds |
| --- | --- |
| `pack.json` | the six tabs |
| `targets/`, `ideals/`, `maps/` | metric definitions, ideal states, the Guard and Decide maps |
| `collectors/<tab>/`, `fixtures/` | the collectors, their tests and test fixtures |
| `tests/moved.json` | where each file came from in Git Crafter |
| `tests/engine-tests.sh` | CI: each file matches its source or is listed as edited, then the tests run beside the pinned engine |

## Add the pack

| Step | Do |
| --- | --- |
| 1 | Adopt Git Crafter: its `templates/ci/README.md` |
| 2 | In `quality/config.json`, add `"packs": ["Colorado-Startups/claudius@<40-hex sha>"]` |
| 3 | `actions/pages` checks the pack out at that SHA and runs its collectors |

| Pin | Works |
| --- | --- |
| Git Crafter engine up to `b02074f` (v4.6.0) | No. That engine still ships these tabs, and a pack named like them is a usage error |
| An engine release without its own Claude tabs, whose `lib` carries every helper these collectors import | Yes: the collectors take every engine helper from `lib` (`collectors/lib/engine.mjs`) |

## The one local command

| Command | Writes | Uploaded |
| --- | --- | --- |
| `node <git-crafter>/quality/collect.mjs --config quality/config.json --local` | `quality/data/local.json` and `quality/history/`, both in `.gitignore` | Never |

## Privacy gate

| Check | Fails when |
| --- | --- |
| [tests/privacy.mjs](tests/privacy.mjs), on every page build | the run is not a CI run, a local-only metric has a value, or a home path or email is in it or in any file the deploy uploads (quality/dist) |
| The same file on your machine, with `PRIVACY_NAMES` set | a listed account name is in the run. CI sets no names |
