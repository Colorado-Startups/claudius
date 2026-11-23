---
name: plan
description: Plans an app, product or feature build as a visual plan of PR-sized steps, one session brief per independent step, checked once before showing. Files GitHub issues and starts sessions when tools allow. Use when someone outlines what to build or asks to plan it, in chat or plan mode.
compatibility: Needs the gh CLI signed in, python3 for the watch, and the Claude desktop app's Code tab for sessions and Artifacts. Without a shell it writes the plan as a table and lists the session briefs.
---

# Plan

The owner outlines the product. Claude plans it visually, and the desktop app runs the plan.

Requires `gh` signed in (`gh auth status`), `python3` for the watch, and the desktop app's Code tab for sessions and Artifacts.

When `mattpocock-skills` (from `claude-plugins-official`) is installed, its `to-spec` writes the PRD and its `to-tickets` files the issues in place of steps 4 and 6 as written; otherwise follow the steps as written.

No `gh` (no shell tool, or `command -v gh` finds nothing), as in chat or Cowork without the tool: skip the `gh` and session steps, and never say issues were filed or sessions started. Give the step 4 table in the reply, then one brief per independent step for the person to paste into a session.

```mermaid
flowchart LR
  O[Outline] --> Q[Product questions] --> E[Equip] --> P[Plan mode] --> A[Plan Artifact] --> C[Check] --> Y[Approve] --> I[Issues]
  I --> S[One session per step] --> W[Watch] --> R[PR] --> M[merge skill] --> L[Live]
```

| # | Step | Do | Tool |
|---|---|---|---|
| 1 | Define | Read the outline and the repo. Ask only product, vision or billing questions: one AskUserQuestion call, at most 4, each with a recommended default. No AskUserQuestion, or no answer: plan on the defaults and list them above the plan; never stop at the questions. Decide engineering, security and settings questions yourself from current docs | AskUserQuestion |
| 2 | Equip | Map: list the session's skills (the listing), plugins (`claude plugin list --json`) and connectors (tool search by area). Pick: each step names its skill, plugin or connector, with a one-line reason; this feeds the Equipped check. Load on use: a step invokes its picks when it runs (Skill tool, tool search `select:`), and nothing else loads. Add mid-task: a step that needs more searches, loads it and adds a row | Skill listing, `claude plugin list`, tool search |
| 3 | Split | In plan mode, cut the work into steps. Each step is one PR of at most 200 changed lines, with its test, touching files no other step touches. If superpowers is installed, its `writing-plans` is the method for design and step-by-step plans | Plan mode |
| 4 | Show | Publish the plan as an Artifact: a flow diagram, then one row per step (step, issue title, files, test, runs with or after, metric it moves). Labels, not paragraphs | Artifacts |
| 5 | Approve | Run the Check table once; if it fixed anything, republish the Artifact. Then ExitPlanMode with the `Checked:` line, the steps and the Artifact link. On a yes, file the issues (step 6), then start one session per independent step on a brief under 150 words plus the worker contract; steps that share files run in order | Sessions, worktrees |
| 6 | File | After the yes, one issue per step: `gh issue create`, its body the step's row and the Artifact link. Add `--type Task` only when `gh api orgs/<owner>/issue-types` lists Task; a 404 or no Task means plain. Also one card per feature or improvement on the owner's board (`gh project item-create`, Status Todo; `gh project item-edit`). Link every issue and card in the plan page. Use the board where the repo's owner keeps one (`gh project list --owner <owner>`). None, or `gh` lacks the `project` scope: skip quietly and say so in the plan | `gh` |
| 7 | Build | A worker branches, opens a draft PR within 10 minutes, pushes after each step, tests, and readies the PR, which says `Closes #<issue>` with a table body. It stops at the open PR. A bug becomes an issue typed Bug (`--type Bug` where `gh api orgs/<owner>/issue-types` lists it, else label `bug`), in the repo at fault; an idea becomes a draft card (`gh project item-create`). File each the moment it is found, after a search (`gh issue list --search`) shows no duplicate, and list it in the PR body's Left table | Auto-fix, `gh` |
| 8 | Watch | Run `python3 -I ${CLAUDE_SKILL_DIR}/scripts/watch_workers.py --workers <file>` under the Monitor tool. The file lists each worker: repo and branch, or a worktree path (format in the script's header). Each minute it reads every branch, PR and CI and prints only changes. A Monitor watch ends at its deadline, at most 30 minutes: start it again on that notice; its state carries over. Before acting on a line, read `ListAgents` where cross-session messaging is on: a worker shown busy gets 10 minutes. `nudge`: message the worker. `restart`: stop it, start a fresh session one step up (effort, then model) told to resume from its branch, then `--reset <name>`. An error line counts as no progress. `done`: its PR is ready and green, or merged. No Monitor: `/loop 1m` with `--once --busy <name>` | Monitor, `ListAgents`, `gh` |
| 9 | Merge | The orchestrator reviews and merges each PR with the `merge` skill | pr-review-toolkit |
| 10 | Live | Load the live page in the app's browser. Mark the step done in the Artifact and republish it | Browser, Artifacts |
| 11 | Wrap up | Before a session ends, reconcile: each merged PR closed its issue, each touched card is moved, each finding is linked | `gh` |

Paste the worker contract into every brief. A cloud session loads the repo's `CLAUDE.md` but no user files or user-scope plugins ([cloud environments](https://code.claude.com/docs/en/cloud-environments), read 2026-11-23), so the brief is the only place a worker sees it.

| Worker contract | The worker |
|---|---|
| Model | Runs on the model and effort the brief names; on anything else, says so in the PR body |
| Files | Touches only the files the brief names |
| Questions | Puts them in the PR body and decides everything else |
| Repo rules | Follows the repo's `AGENTS.md` and `CLAUDE.md` where present. Never pushes to main, force-pushes or commits a secret |
| Findings | Files each bug as an issue in the repo at fault, and each idea as a draft card (`gh project item-create`), when found and after a search for a duplicate. Lists each in the PR body |
| Pushes | Opens a draft PR within 10 minutes and pushes after each step, so the orchestrator sees progress |
| Done when | Stops at the open PR once the goal the brief states is met. Never merges or approves its own PR |

| Check once, before Approve | Passes when |
|---|---|
| True | Every file, command and setting the plan names was read this session. Doc facts come from the live page |
| Whole | Every part of the ask has a step. Every step has its test |
| Small | Nothing beyond the ask. Where the repo has a Quality page, each step names the metric it moves |
| Equipped | Each step names the skill, plugin or connector it uses. A missing one is listed to add |
| Owner | Only product and billing items wait for the owner, each with a default |
| Tracked | Every step has an issue, every feature a card |

Fix what fails. Then put one line above the plan, each row marked ✅ for a pass or ❌ for a fail: `Checked: True ✅ · Whole ✅ · Small ✅ · Equipped ✅ · Owner ✅ · Tracked ✅ · Changed: <what the check fixed>`. A row that still fails after the pass keeps its ❌, with the reason in that line. One pass, never a loop. The check runs for any plan in plan mode, even one with no issues or sessions to follow. When the owner says "check", run the same table.

| Keep usage low | Rule |
|---|---|
| Briefs | A worker starts fresh on its brief, not a fork of the planning conversation. The brief names the picked skills to use first, limits what the worker does, and never limits which plugins, skills or connectors it reaches ([All on, app-wide](https://github.com/Colorado-Startups/claudius/blob/main/templates/claude/README.md#all-on-app-wide)) |
| Reads | A search across many files goes to `Explore` with `model: "haiku"` |
| Waits | CI, conflicts and review comments come from Auto-fix, never a poll. The watch reads GitHub, not the model: the orchestrator spends a turn only when it prints a line |
| Rounds | At most three review rounds a PR; after that, rethink the step |
