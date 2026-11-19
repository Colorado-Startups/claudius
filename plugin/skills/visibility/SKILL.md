---
name: visibility
description: Audits which repos of a GitHub org are public or private in one run, and lists each check as a table. Use when asked which repos should be public or private, before changing a repo's visibility, or before calling a repo retired.
compatibility: Needs the gh CLI signed in as an org owner, so private repos and scanning settings are visible, plus git and curl. Without a shell it gives the checks as a table for the person to run.
---

# Visibility

One audit per org: every repo, both sides checked, counts reported. It reads only; every change waits for the person's yes.

Requires `gh` signed in as an org owner (`gh auth status`), `git` and `curl`. ORG, REPO and BRANCH below are placeholders.

No `gh` (no shell tool, or `command -v gh` finds nothing): give the table below with its commands for the person to run, and read back what they paste.

| # | Check | Command or rule |
|---|---|---|
| 1 | List | `gh api --paginate 'orgs/ORG/repos?per_page=100&type=all' --jq '.[] \| [.name, .visibility, .archived, .has_pages, .forks_count] \| @tsv'` |
| 2 | Count | `gh api orgs/ORG --jq .total_private_repos` equals the private rows. Fewer, or none: this login cannot see them all, so say so and stop |
| 3 | Pages | Each private repo with a site: `gh api repos/ORG/REPO/pages --jq .public` is `false`, and `curl -sL -o /dev/null -w '%{http_code} %{url_effective}' URL` signed out lands on a sign-in, not a 200 page |
| 4 | Emails | Every branch of each public repo: `gh api 'repos/ORG/REPO/commits?sha=BRANCH&per_page=100' --jq '.[].commit.author.email'`. Count addresses that are neither `users.noreply.github.com` nor the org's domain. Report counts, never an address |
| 5 | Scanning | Each public, unarchived repo: `.security_and_analysis.secret_scanning.status` and `.secret_scanning_push_protection.status` from check 1's list are `enabled` |
| 6 | Private terms | The term list comes from a local file path the person gives at run time, never from chat or the repo. `git clone --no-checkout` the repo, then `git -C DIR grep -c -i -F -f PATH $(git -C DIR for-each-ref --format='%(refname)' refs/remotes/origin)`. Report counts per branch and file, never a term |
| 7 | Retire | Check every branch, not only the default, before calling a repo retired: `gh api 'repos/ORG/REPO/branches?per_page=100' --jq '.[].name'`, then each branch's commits ahead of the default |
| 8 | Forks | Making a public repo private leaves its public forks public ([setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility), read 2026-11-19). Count them before history is rewritten |
| 9 | Report | One row per repo: visibility, archived, site, emails, scanning, terms, forks, and the side it belongs on |

| Measure | Where |
|---|---|
| Checks 1 to 5 | The Visibility tab of the Claudius Quality page, one collector run. Goals: 0 private repos with a public page, 0 public repos without scanning, 0 personal emails in public history |
| Not measured in CI | Checks 2, 3 and 5 need an admin token; without one they read not measured, never 0 |

| Never | Why |
|---|---|
| Print an email or a private term | the report is shared; counts carry the finding |
| Name a private repo in a public place | a PR, issue or public page is readable by anyone |
| Change visibility, Pages or a repo's existence unasked | each is the person's call; deleting a repo is their click |
