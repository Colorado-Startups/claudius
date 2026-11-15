# Claudius by Colorado Startups

An Anthropic-first workflow for the Claude desktop app. Claudius adds only what Anthropic's own plugins and the reviewed directory don't already cover, so nothing duplicates them.

| Skill | Use it when | Builds on |
|---|---|---|
| `plan` | someone outlines a product or feature | plan mode, Artifacts, sessions, superpowers `writing-plans` |
| `merge` | a pull request is open | Anthropic's `pr-review-toolkit`, `gh` |
| `equip` | sessions feel heavy, or an account is being set up | `/plugin`, `claude plugin`, `/usage` |

| Install | Command |
|---|---|
| From this repo | `claude plugin marketplace add Colorado-Startups/claudius` then `claude plugin install claudius@claudius` |

## Measured

| Skill | With Claudius | Without | Change |
|---|---|---|---|
| `merge` | 1.00 | 0.00 | +1.00 |
| `equip` | 1.00 | 0.00 | +1.00 |
| `plan` | 0.33 | 0.00 | +0.33 |

`claude plugin eval` on Claude Sonnet 5.5, 3 runs per arm, judged by Sonnet 5.5 (2026-11-15). Cases are in [evals/](evals/). A skill that doesn't beat the no-plugin baseline is left out.

## What it runs and sends

| Component | Count |
|---|---|
| Skills (instructions only) | 3 |
| Hooks, MCP servers, scripts, binaries | 0 |

The skills tell Claude to run commands you could run yourself: `gh` (GitHub CLI, for pull requests, checks and repository search), `claude plugin` (list, install, enable, disable, uninstall, details), `git`. Claudius sends no data anywhere and stores none. It reads your local Claude Code plugin records and transcripts only when you ask the `equip` skill to measure use.

Claudius is not an Anthropic product and is not affiliated with Anthropic. Source: [Colorado-Startups/claudius](https://github.com/Colorado-Startups/claudius). Credits: [NOTICE](NOTICE).
