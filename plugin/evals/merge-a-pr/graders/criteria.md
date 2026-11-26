---
type: llm
---

PASS if the walkthrough reviews the PR at a specific head commit SHA (with two separate reviewers or review passes, and no wait for a person's yes), records a MERGE or BLOCK verdict tied to that SHA, and merges only that same commit (for example gh pr merge with --match-head-commit). FAIL if the merge isn't tied to the reviewed commit.
