# Code Project template

Set up a Claude Code Project (a coordinating conversation plus the cloud threads it starts) so each thread ships a pull request and nothing a repo relies on is skipped. The project, instructions and environment steps live in Git Crafter [`templates/projects`](https://github.com/SoulCraft-Org/git-crafter/tree/main/templates/projects). This folder adds the Claude-only parts and links, not copies, the rest.

## Quick start

```mermaid
flowchart LR
  A[1 Git Crafter projects template:<br/>project, instructions, environment] --> B[2 This folder:<br/>memory seeds, agents, tasks]
  B --> C[3 Setup check message]
  C -->|pass| D[Threads: branch, draft PR]
  C -->|gap| E[Fix the gap, check again]
  E --> C
```

| # | Do | Who |
|---|---|---|
| 1 | Follow Git Crafter [`templates/projects/README.md`](https://github.com/SoulCraft-Org/git-crafter/blob/main/templates/projects/README.md) steps 1 to 4 | Claude, then owner for keys |
| 2 | Copy `agents/` to `.claude/agents/` in each attached repo. Paste the [memory seeds](#memory-seeds) into the first message. Create the [scheduled tasks](#scheduled-tasks) | Claude |
| 3 | Send the setup check from Git Crafter [`templates/projects/README.md`](https://github.com/SoulCraft-Org/git-crafter/blob/main/templates/projects/README.md#steps) | owner |

## Where a guard lives

A cloud thread skips a repo's `.claude/settings.json` permission rules, hooks and `env`, and its `.mcp.json` servers. A guard that must hold in every thread goes where the thread reads it.

| Guard | Put it in | Why |
|---|---|---|
| Never merge, never push to the default branch | Project instructions and the repo's GitHub ruleset | The instruction steers the thread. The ruleset refuses the push |
| Never print or commit a key | Project instructions, `CLAUDE.md`, secret scanning with push protection | Deny rules in `settings.json` do not run in a cloud thread |
| Tests before merge | The required CI check | A thread cannot skip a check GitHub enforces |
| Network and variables | The cloud environment | `env` in `settings.json` is not applied |
| Deny list and hooks | Keep them in `.claude/settings.json` for local threads and Remote Control sessions | They are a backstop there, not a cloud guard |

## Memory seeds

Project memory is files that every cloud thread reads at start, kept on in claude.ai settings. Ask Claude once to save each seed as its own short note.

| Note | Says |
|---|---|
| Run location | Where long runs go: this computer, GitHub, or the cloud, and when |
| Billing decisions | What is bought, what is free, and the rule for new spend. Names only, no account ids |
| Repo map | Which repos are attached, which are added when needed, and any dot-named repo worked in a Remote Control session |
| Tracking | A bug, quick fix or error is an issue. A feature or improvement is a card. Both are recorded, finished or open ([tracking](https://github.com/SoulCraft-Org/git-crafter/blob/main/templates/projects/tracking.md)) |

## Subagents

Cloud threads load a repo's `.claude/agents/`. The explorer reads and reports, so side work stays out of the thread's context. For review, use the `pr-review-toolkit` agents ([templates/claude/README.md](../README.md#plugins)) instead of a copy here.

| File | Model | Does |
|---|---|---|
| [`agents/explorer.md`](agents/explorer.md) | Haiku | Finds files and answers where a thing is defined, read only |

## Scheduled tasks

A cloud scheduled task runs without a conversation. It ignores the connectors it does not need and leaves them on ([All on, app-wide](../README.md#all-on-app-wide)).

| Task | When | Does |
|---|---|---|
| Dependency and CI digest | Weekly | Lists open Dependabot PRs and failing checks, one table |
| Quality read | Weekly | Reads each Quality page, lists the three biggest misses |
| Pin check | Monthly | Runs `bump-pins`, opens a PR if a pin moved |

## Limits

| Limit | Value | Do |
|---|---|---|
| Plans | Pro, Max or Ultra. Not Team or Enterprise | Check **Projects** shows in the sidebar |
| New threads | 500 a day | One thread per task |
| Cache | One hour | A fresh thread for new work |
| Local thread memory | A thread on your computer starts with the project's instructions, not its memory files. Connecting the folder through Remote Control needs Claude Code v2.1.280 or later ([Projects](https://code.claude.com/docs/en/claude-projects), read 2026-11-25) | Put the rules it needs in `CLAUDE.md` or `AGENTS.md` |
| Attached repo access | An attached repo can still fail to connect ([Projects](https://code.claude.com/docs/en/claude-projects), read 2026-11-25) | Read a file and push a branch in each repo first. Record a failing repo as untested, and work it from a local thread |
| Repo named with a dot | Such a repo, `.github` for one, makes the thread skip every repo's skills, agents and commands ([Projects](https://code.claude.com/docs/en/claude-projects), read 2026-11-25) | Run that thread as a Remote Control session, or enable the skills for your claude.ai account |
| Merge from a cloud thread | A cloud thread's proxy blocks GraphQL, so `gh pr merge` fails there | Merge from a local thread or a Remote Control session with `gh pr merge --squash --match-head-commit <reviewed sha>`. Where the session offers ready-for-review and auto-merge calls, use them with the reviewed head SHA as the guard. The [merge skill](../../../plugin/skills/merge/SKILL.md#in-a-cloud-thread) has the steps |

## Sources

Read 2026-11-25: [Projects](https://code.claude.com/docs/en/claude-projects) for what a thread loads, memory, the 500 thread limit, the one hour cache and plan availability. [Cloud environments](https://code.claude.com/docs/en/cloud-environments) for variables and network secrets. [Sub-agents](https://code.claude.com/docs/en/sub-agents) for agent files.
