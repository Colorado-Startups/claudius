---
name: merge
description: Reviews a pull request twice with pr-review-toolkit, posts a MERGE or BLOCK verdict per review pinned to the head commit, and merges only that commit once both say MERGE. Use when asked to merge a pull request, or when a pasted diff needs a merge verdict.
compatibility: Needs the gh CLI signed in and the pr-review-toolkit plugin from claude-plugins-official. Without a shell it reviews a diff the person pastes and gives the verdict.
---

# Merge

Two separate reviews per PR, pinned to a commit, so what merges is what was reviewed. An AI review is the approval ([GOVERNANCE](../../../GOVERNANCE.md)): once the checks are green and both reviews say MERGE at the head commit, the agent merges with no wait for a person's yes. A review-only request gets the verdict in chat.

Requires `gh` signed in (`gh auth status`) and `pr-review-toolkit` from `claude-plugins-official` (`claude plugin install pr-review-toolkit@claude-plugins-official`).

No `gh` (no shell tool, or `command -v gh` finds nothing), as in chat or Cowork without the tool: give the steps below with the exact commands for the person to run at the head SHA. Review any pasted diff in the two passes of step 3 and reply `MERGE <sha>` or `BLOCK <sha>` with fixes as file, problem, replacement. After a fix, review only the delta from the blocked SHA and give a new verdict for the new head. Leave posting and merging to the person.

```mermaid
flowchart LR
  C[Checks green] --> R[Two reviewers at the head SHA] -->|BLOCK| F[Fix, push] --> D[Review the delta] --> R
  R -->|both MERGE| V[Post verdict] --> Q[Merge at the reviewed SHA] --> M[Merged]
  Q -->|conflict| U[Merge main in, push] --> D
```

| # | Step | Command or rule |
|---|---|---|
| 1 | Wait once | `gh pr checks N --watch --interval 60`, in the background. Never a tight poll |
| 2 | Pick the reviewers | Two fresh `pr-review-toolkit:code-reviewer` subagents, neither the PR's author, and the second never shown the first's verdict. Model: Haiku for docs, data and code under about 200 lines; Sonnet for settings, workflows, permissions, rules or anything larger; the second reviewer at the same model or one step up |
| 3 | Brief | The PR number, head SHA (`gh pr view N --json headRefOid -q .headRefOid`) and intent in a few lines; the reviewer reads `gh pr diff N`. Two passes: mechanical (it does what it says, every check passed), then judgment (what breaks). Each reviewer replies in at most 120 words: `MERGE <sha>` or `BLOCK <sha>` plus fixes as file, problem, replacement |
| 4 | Fix | On BLOCK, fix on the branch and push. Send the same reviewers only the delta from the reviewed SHA. Each finding is fixed, or linked to an issue or card, before merge |
| 5 | Verdict | Post a PR comment whose first line is exactly `Review: MERGE at <40-hex sha>` (`BLOCK` in place of `MERGE` for a blocked commit) for each reviewer, with a second line naming the reviewer and its model. Merge once both say MERGE and the checks are green. No wait for a person's yes: a person's veto comment on the PR is the only stop, so read the PR's comments just before merging. One account that authors and merges leaves no GitHub review, so this line is the record |
| 6 | Queue | Queue every PR with both MERGE verdicts and green checks at once, each at the literal SHA that passed: `gh api graphql -f query='mutation($id:ID!,$sha:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$sha}){mergeQueueEntry{position}}}' -F id=<PR node id> -F sha=<sha>`. The node id is `gh pr view N --json id -q .id` |
| 7 | No queue yet | Set one up (table below). Until then, `gh pr merge N --squash --match-head-commit <sha>`, one PR at a time, in a method the repo allows (`gh api repos/{owner}/{repo}`) |
| 8 | Conflict | A PR the queue drops for a conflict goes back: merge `main` into its branch, resolve each hunk, push, review the delta (step 4) and queue the new head |
| 9 | After | The PR's `Closes #N` closes the issue. Where the board's "Pull request merged" workflow is on, its card moves itself: no move is needed. Otherwise move the card to Done (`gh project item-edit`; no board, skip quietly). If the merge deploys, load the live page once |

## In a cloud thread

`gh pr checks`, `gh pr view`, `gh pr diff`, `gh pr merge` and the queue mutation use GraphQL, and a Claude Code Project cloud thread may be unable to run them. If one fails there, do every step with `gh api` REST: reads, a comment per verdict and the merge itself. No hand-off to a local session is needed unless the repo requires a merge queue (below).

| Step | REST form |
|---|---|
| 1 Checks | `gh api repos/{owner}/{repo}/commits/<sha>/check-runs` |
| 3 Head SHA | `gh api repos/{owner}/{repo}/pulls/N --jq .head.sha` |
| 3 Diff | `gh api -H 'Accept: application/vnd.github.diff' repos/{owner}/{repo}/pulls/N` |
| 5 Verdict | `gh api repos/{owner}/{repo}/issues/N/comments -f body=...` |
| 6 and 7 Merge | `gh api -X PUT repos/{owner}/{repo}/pulls/N/merge -f merge_method=squash -f sha=<reviewed sha>`: GitHub refuses it if the head moved. Where the repo requires a merge queue and no REST route enqueues, leave the PR with both MERGE verdicts and the queue mutation for a local thread: the only case that needs one |

Green CI, two separate reviews and the head SHA guard all stay. Never bypass a required merge queue.

| Repo setup | Rule |
|---|---|
| Ruleset on `main` | A merge queue: squash, only non-failing PRs grouped (`ALLGREEN`), up to 5 built and merged together |
| Up to date | No "require branches to be up to date" rule: the queue tests each PR on the latest `main` ([managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue), read 2026-11-18) |
| Branch-name rulesets | Allow the queue's `gh-readonly-queue/*` branches, or the queue fails at once |

On 2026-11-18 one repo switched from serial merges to this queue. Eight PRs merged in one queue pass of about 10 minutes; each had taken about 10 minutes serially, since every merge re-ran the other PRs' CI. Only PRs that touched the same file came back with a conflict.

| Measure | Where |
|---|---|
| All green to merge | The `all green to merge` part of `lead_time.hours` (goal: 24 h for the whole lead time) |
| One queue pass | Goal: every ready PR merged in one pass, minutes from the first queue entry to the last merge. No collector reads it yet |

| Never | Why |
|---|---|
| `--auto` or `--admin` | merges something other than the reviewed commit, or skips the rules |
| Queueing without `expectedHeadOid` | the queue could merge a commit pushed after the review |
| A fourth review round | three rounds without MERGE means the step needs rethinking |
| Push to `main` or force-push | the reviewed history is the record |
