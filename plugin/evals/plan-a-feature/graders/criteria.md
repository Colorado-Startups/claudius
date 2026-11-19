---
type: llm
---

PASS if the plan breaks the feature into small steps, each sized as one pull request with its own test and the files it touches, shown as a table, list or diagram a person can scan, and the reply shows one `Checked:` line with a pass or fail mark for each of True, Whole, Small, Equipped and Owner. It also says which steps are independent and can run as separate sessions at the same time, and which must run in order because they depend on or share files with another step. FAIL if it is one undivided block of work, if it gives no way to tell which steps can run in parallel, or if the reply has no `Checked:` line that marks each of True, Whole, Small, Equipped and Owner as a pass or a fail.
