# Privacy

The plugin itself collects nothing and sends nothing of its own. Its one script, `watch_workers.py` (part of `plan`), reads the branches, pull requests and checks you list by REST through your signed-in `gh`, writes only a small state file of timestamps and shas in the temp directory, and sends nothing anywhere else. Its skills run `gh` commands that write to GitHub under your account, and `plan` saves its plan as an Artifact in your claude.ai account. It is six skills, instructions Claude reads, plus that one script, with no hooks or servers.

| Data | Claudius does |
|---|---|
| Collects | Nothing |
| Sends | Nothing of its own: no telemetry, no analytics. Skills run `gh`, which writes to GitHub under your account, and `watch_workers.py` reads GitHub through it |
| Stores | No accounts or settings of its own, and one small state file of timestamps and shas, with its `.lock`, in the temp directory while `plan` watches workers. `plan` saves its plan as an Artifact in your claude.ai account |
| Shares | With no one |

| Skill | What it touches | Where |
|---|---|---|
| `plan` | `gh` commands Claude runs to file issues in your repository, and an Artifact holding the plan | GitHub through your own `gh` sign-in; your claude.ai account |
| `merge` | `gh` commands Claude runs to read checks, post a verdict and merge | Through your own `gh` sign-in |
| `equip` | Claude Code plugin records and session transcripts, only when you ask it to measure use | On your machine, read and not copied |
| `visibility` | `gh api` reads of an org's repos, one signed-out request to each private repo's site, a clone of a public repo, and a term list file you name | Through your own `gh` sign-in; on your machine, counts only |

Anything a skill does on GitHub, GitHub receives under your account and handles under [its privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Anything Claude reads in a session goes to Anthropic as part of that session, under [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

Questions: [SUPPORT.md](SUPPORT.md). A security problem: [SECURITY.md](SECURITY.md).
