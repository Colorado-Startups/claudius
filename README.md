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

## Add the pack

| Step | Do |
| --- | --- |
| 1 | Adopt Git Crafter: its `templates/ci/README.md` |
| 2 | In `quality/config.json`, add `"packs": ["Colorado-Startups/claudius@<40-hex sha>"]` |
| 3 | `actions/pages` checks the pack out at that SHA and runs its collectors |

| Pin | Works |
| --- | --- |
| Git Crafter engine up to `8e284cb` | No. That engine still ships these tabs, and a pack named like them is a usage error |
| An engine release without its own Claude tabs | Yes |

## The one local command

| Command | Writes | Uploaded |
| --- | --- | --- |
| `node <git-crafter>/quality/collect.mjs --config quality/config.json --local` | `quality/data/local.json` and `quality/history/`, both in `.gitignore` | Never |

## Privacy gate

| Check | Fails when |
| --- | --- |
| [tests/privacy.mjs](tests/privacy.mjs), on every page build | the run is not a CI run, a local-only metric has a value, or a home path, email or account name is in it |
