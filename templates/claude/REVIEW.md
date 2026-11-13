# Review instructions

For Claude Code's Code Review service only (Team and Enterprise plans, billed per review). Local `/code-review` reads `CLAUDE.md`, not this file (code.claude.com/docs/en/code-review-customize, read 2026-11-13).

## What Important means here

Important: a change that breaks behavior, leaks a key or a private name, or widens what an agent may do without saying so. Style and naming are Nit at most.

## Cap the nits

Report at most three Nits per review.

## Do not report

- Anything CI already enforces: tests, the privacy gate, the guard self-test, pinned-SHA checks
- Generated files under `quality/public/` and `quality/dist/`
- Fixture data under `fixtures/`

## Always check

- No key value, home path or email in the diff
- Every `uses:` pins a full 40-hex SHA with a version comment
- No workflow checks out a pull request's head under `pull_request_target`
- `.claude/settings.json` `permissions.deny` loses no rule
- A guard change keeps one regression case
