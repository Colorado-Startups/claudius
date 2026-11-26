---
name: visibility
description: Audits which repos of a GitHub org are public or private in one run, as a table, and fixes missing secret scanning and public sites on private repos. Use when asked which repos should be public or private, or before calling a repo retired.
compatibility: Needs the gh CLI signed in as an org owner, so private repos and scanning settings are visible, plus git and curl. Without a shell it gives the checks as a table for the person to run.
---

# Visibility

**Outcome:** Claudius sets up the Claude desktop app as an autonomous, agentic system: you give the objective and the vision, and Claude plans, builds, reviews and merges on its own, asking you only about vision, billing, a one-way change or a step the platform forces.

One audit per org: every repo, both sides checked, counts reported. It reads, then fixes what is reversible and safe (scanning on, a private repo's site private). Publishing a repo or deleting one is a one-way change, left to the owner as one exact line.

Requires `gh` signed in as an org owner (`gh auth status`), `git` and `curl`. ORG, REPO and BRANCH below are placeholders.

No `gh` (no shell tool, or `command -v gh` finds nothing): give the table below with its commands for the person to run, and read back what they paste.

| # | Check | Command or rule |
|---|---|---|
| 1 | List | `gh api --paginate 'orgs/ORG/repos?per_page=100&type=all' --jq '.[] \| [.name, .visibility, .archived, .has_pages, .forks_count] \| @tsv'` |
| 2 | Count | `gh api orgs/ORG --jq .total_private_repos` equals the private rows. Fewer, or none: this login cannot see them all, so say so and stop |
| 3 | Pages | Each private repo with a site: `gh api repos/ORG/REPO/pages --jq .public` is `false`, and `curl -sL -o /dev/null -w '%{http_code} %{url_effective}' URL` signed out lands on a sign-in, not a 200 page |
| 4 | Emails | Every commit of every branch of each public repo, every page: `gh api --paginate 'repos/ORG/REPO/commits?sha=BRANCH&per_page=100' --jq '.[].commit.author.email'`. Count addresses that are none of these: `users.noreply.github.com`, the org's domain, or a tool address such as `noreply@anthropic.com` (Claude Code cloud sessions; the collector's `params.bot_emails`). Report counts, never an address |
| 5 | Scanning | Each public, unarchived repo: `.security_and_analysis.secret_scanning.status` and `.secret_scanning_push_protection.status` from check 1's list are `enabled` |
| 6 | Private terms | The term list comes from a local file path the person gives at run time, never from chat or the repo. `git clone --no-checkout` the repo, then `git -C DIR grep -c -i -F -f PATH $(git -C DIR for-each-ref --format='%(refname)' refs/remotes/origin)`. Report counts per branch and file, never a term |
| 7 | Retire | Check every branch, not only the default, before calling a repo retired: `gh api --paginate 'repos/ORG/REPO/branches?per_page=100' --jq '.[].name'`, then each branch's commits ahead of the default |
| 8 | Forks | Making a public repo private leaves its public forks public ([setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility), read 2026-11-19). Count them before history is rewritten |
| 9 | Fix | A public repo without scanning: `gh api -X PATCH repos/ORG/REPO -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'`. A private repo with a public site, on a plan that has private sites: `gh api -X PUT repos/ORG/REPO/pages -F public=false`. Re-run its check after each fix |
| 10 | Report | One row per repo: visibility, archived, site, emails, scanning, terms, forks, the fix made, and the side it belongs on |
| Personal | A personal account (`gh api orgs/OWNER` answers 404), signed in as that user: `gh api users/OWNER --jq .total_private_repos` and `gh api --paginate 'user/repos?per_page=100&affiliation=owner'` replace checks 1 and 2, and check 5 reads `gh api repos/OWNER/REPO --jq .security_and_analysis` per public repo, as `user/repos` omits it. Check 3 runs as written. Check 4 runs as written, but the profile's own site and email domain are not exempt, so its address counts as personal. A check the login cannot make is not measured, never 0, and that includes a signed-in login that is not the owner and a list shorter than `gh api users/OWNER --jq .public_repos` |

| Measure | Where |
|---|---|
| Checks 1 to 5 | The Visibility tab of the Claudius Quality page, one collector run. Goals: 0 private repos with a public page, 0 public repos without scanning, 0 personal emails in public history |
| Not measured in CI | Checks 2, 3 and 5 need an admin token; without one they read not measured, never 0 |

| Never | Why |
|---|---|
| Print an email or a private term | the report is shared; counts carry the finding |
| Name a private repo in a public place | a PR, issue or public page is readable by anyone |
| Make a private repo public, or delete a repo | one-way: the owner decides, as one exact line |
