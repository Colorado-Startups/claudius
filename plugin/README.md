![Claudius, an AI agent character](assets/claudius-icon.png)

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

## Where it works

| Skill | Chat | Cowork | Claude Code |
|---|---|---|---|
| `plan` | ➖ table and briefs | ➖ if tool missing | ✅ issues and sessions |
| `merge` | ➖ review pasted diff | ➖ if tool missing | ✅ review and merge |
| `equip` | ➖ checklist only | ➖ if tool missing | ✅ audit and trim |

✅ runs the commands. ➖ the shell-free path: the skill checks for `gh` or `claude` first, and if it's missing, gives a plan, verdict or checklist for you to act on. In Cowork a skill takes the same path when its tool isn't installed. Skills load in chat, Cowork and Claude Code ([platform support](https://claude.com/docs/plugins/platform-support), read 2026-11-15).

| Install on | How |
|---|---|
| Claude Code | the commands above |
| Chat and Cowork | **Customize > Plugins**, add the GitHub repo `Colorado-Startups/claudius` as a marketplace |

## Measured

| Skill | Sonnet 5.5 with | Sonnet 5.5 without | Change | Haiku 5.5 | Opus 5.5 |
|---|---|---|---|---|---|
| `merge` | 1.00 | 0.00 | +1.00 | pending | pending |
| `equip` | 1.00 | 0.00 | +1.00 | pending | pending |
| `plan` | 0.33 | 0.00 | +0.33 | pending | pending |

`claude plugin eval`, 3 runs per arm, judged by Sonnet 5.5 (2026-11-15). Those Sonnet figures cover the first three cases, one per skill. All 9 cases (three per skill, in [evals/](evals/)) run on all three models after the weekly usage reset on 2026-11-19. A skill that doesn't beat the no-plugin baseline is left out.

## What it runs and changes

| Component | Count |
|---|---|
| Skills (instructions only) | 3 |
| Hooks, MCP servers, scripts, binaries | 0 |

| Skill | Runs | Changes |
|---|---|---|
| `plan` | `gh` | GitHub issues in your repo; sessions you start |
| `merge` | `gh`, `git` | A PR comment and a merge, at the reviewed commit only |
| `equip` | `claude plugin` | Installed and enabled plugins, and repo `.claude/settings.json`, only after you say yes to its change table |

Claudius sends no data anywhere and stores none. It reads your local Claude Code plugin records and transcripts only when you ask the `equip` skill to measure use. Details: [PRIVACY.md](https://github.com/Colorado-Startups/claudius/blob/main/PRIVACY.md).

Claudius is not an Anthropic product and is not affiliated with Anthropic. Source: [Colorado-Startups/claudius](https://github.com/Colorado-Startups/claudius). Credits: [NOTICE](NOTICE).
