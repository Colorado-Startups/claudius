# Privacy

The Claudius plugin collects, sends and stores nothing. It is three skills: instructions Claude reads, with no hooks, servers or scripts.

| Data | Claudius does |
|---|---|
| Collects | Nothing |
| Sends | Nothing. No telemetry, no analytics, no network calls of its own |
| Stores | Nothing. No files, accounts or settings of its own |
| Shares | With no one |

| Skill | What it touches | Where |
|---|---|---|
| `plan` | `gh` commands Claude runs to file issues in your repository | Through your own `gh` sign-in |
| `merge` | `gh` commands Claude runs to read checks, post a verdict and merge | Through your own `gh` sign-in |
| `equip` | Claude Code plugin records and session transcripts, only when you ask it to measure use | On your machine, read and not copied |

Anything a skill does on GitHub, GitHub receives under your account and handles under [its privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Anything Claude reads in a session goes to Anthropic as part of that session, under [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

Questions: [SUPPORT.md](SUPPORT.md). A security problem: [SECURITY.md](SECURITY.md).
