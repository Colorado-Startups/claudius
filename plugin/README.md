![Claudius, an AI agent character](https://raw.githubusercontent.com/Colorado-Startups/brand/v3.2.0/dist/logo/claudius-icon-1024.png)

# Claudius by Colorado Startups

**Outcome:** Claudius sets up the Claude desktop app as an autonomous, agentic system: you give the objective and the vision, and Claude plans, builds, reviews and merges on its own, asking you only about vision, billing or a step the platform forces.

An Anthropic-first workflow for the Claude desktop app. Claudius adds only what Anthropic's own plugins and the reviewed directory don't already cover, so nothing duplicates them.

| Skill | Use it when | Builds on |
|---|---|---|
| `plan` | someone outlines a product or feature, or plan mode is on | plan mode, Artifacts, sessions, superpowers `writing-plans` |
| `merge` | a pull request is open | Anthropic's `pr-review-toolkit`, `gh` |
| `equip` | sessions feel heavy, or an account is being set up | `/plugin`, `claude plugin`, `/usage` |
| `find-plugin` | someone asks if a plugin, skill or connector exists for a task | Anthropic's catalog, the directory, `skill-creator` |
| `plain-voice` | docs, READMEs, PR text or emails are drafted or edited | `brand-voice`, when installed |
| `visibility` | someone asks which repos should be public or private, or retires one | `gh`, GitHub Pages and secret scanning |

| Install | Command |
|---|---|
| From this repo | `claude plugin marketplace add Colorado-Startups/claudius` then `claude plugin install claudius@claudius` |

## Where it works

| Skill | Chat | Cowork | Claude Code |
|---|---|---|---|
| `plan` | ➖ table and briefs | ➖ if tool missing | ✅ issues and sessions |
| `merge` | ➖ review pasted diff | ➖ if tool missing | ✅ review and merge |
| `equip` | ➖ checklist only | ➖ if tool missing | ✅ audit and adopt |
| `find-plugin` | ➖ answers from the listing | ➖ answers from the listing | ✅ reads the catalog |
| `plain-voice` | ✅ no tool needed | ✅ no tool needed | ✅ no tool needed |
| `visibility` | ➖ checklist only | ➖ if tool missing | ✅ runs the audit |

✅ runs the commands. ➖ the shell-free path: the skill checks for `gh` or `claude` first, and if it's missing, gives a plan, verdict or checklist for you to act on. In Cowork a skill takes the same path when its tool isn't installed. Skills load in chat, Cowork and Claude Code ([platform support](https://claude.com/docs/plugins/platform-support), read 2026-11-15).

| Install on | How |
|---|---|
| Claude Code | the commands above |
| Chat and Cowork | **Customize > Plugins**, add the GitHub repo `Colorado-Startups/claudius` as a marketplace |

## Measured

| Lift | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| `plan` | ✅ +1.00 | ✅ +0.89 | ✅ +0.67 |
| `merge` | ✅ +0.22 | ✅ +0.89 | ✅ +0.22 |
| `equip` | ✅ +0.33 | ✅ +0.33 | ✅ +0.33 |
| `find-plugin` | ✅ +0.67 | ✅ +0.67 | ✅ +0.67 |
| `plain-voice` | ✅ +0.33 | ✅ +0.67 | ✅ +0.44 |
| `visibility` | ✅ +0.33 | ✅ +0.33 | ✅ +0.33 |

Lift is the mean score with Claudius minus without it, over each skill's three cases in [evals/](evals/). Measured with `claude plugin eval`, judged by Sonnet 5.5, on 2026-11-15: `merge` and `plain-voice` cases ran 3 times per arm, the others once. The `plan` cases were re-measured on 2026-11-19 at plugin 0.4.1. Their grader now also requires the `Checked:` line. Only Claudius writes that line, so the without arm scores 0. The `plan` figures measure that line, from three runs per arm. The `visibility` cases were measured on 2026-11-19 at plugin 0.4.1, three runs per arm. Scores: [quality/evals](https://github.com/Colorado-Startups/claudius/tree/main/quality/evals). A skill that doesn't beat the no-plugin baseline is left out.

## What it runs and changes

| Component | Count |
|---|---|
| Skills (instructions only) | 6 |
| Scripts | 1: `plan/scripts/watch_workers.py` |
| Hooks, MCP servers, binaries | 0 |

| Skill | Runs | Changes |
|---|---|---|
| `plan` | `gh`, `python3 watch_workers.py`, which reads GitHub by `gh api` | GitHub issues in your repo; sessions you start; a state file and its `.lock` in `$TMPDIR` |
| `merge` | `gh`, `git` | A PR comment and a merge, at the reviewed commit only |
| `equip` | `claude plugin` | Installs official plugins, turns back on ones left off and removes install records whose project folder is gone, only after you say yes to its change table. It turns nothing off ([All on, app-wide](https://github.com/Colorado-Startups/claudius/blob/main/templates/claude/README.md#all-on-app-wide)) |
| `find-plugin` | `claude plugin install`, after a yes | Nothing until you say yes |
| `plain-voice` | nothing | Nothing; it returns text |
| `visibility` | `gh api`, `git clone`, `curl`, all reads | Nothing; it reports counts |

The plugin itself collects nothing and sends nothing of its own. Its one script, `watch_workers.py`, reads the branches, pull requests and checks you list by REST through your signed-in `gh`, writes only a small state file of timestamps and shas in the temp directory, and sends nothing anywhere else. Its skills run `gh` commands that write to GitHub under your account, and `plan` saves its plan as an Artifact in your claude.ai account. It reads your local Claude Code plugin records and transcripts only when you ask the `equip` skill to measure use. Details: [PRIVACY.md](https://github.com/Colorado-Startups/claudius/blob/main/PRIVACY.md).

Claudius is not an Anthropic product and is not affiliated with Anthropic. Source: [Colorado-Startups/claudius](https://github.com/Colorado-Startups/claudius). Credits: [NOTICE](NOTICE).
