# Claude API

Max, Ultra and Team plans include monthly Claude API credits. GitHub Actions can call the API with no stored key through workload identity federation (WIF). The credits do not pay for the Desktop App.

```mermaid
flowchart LR
  P[Claude API] --> S[Sign in<br/>Console organization,<br/>WIF in CI] --> G[Spend stop<br/>credits run out,<br/>auto-reload off]
  G -.-> C[Claude Desktop App, Code tab<br/>not covered]
  G -.-> W[Claude Desktop App, Cowork<br/>not covered]
```

| Account | Free tier | Login or key | Claude connector | Guard |
| --- | --- | --- | --- | --- |
| A Claude Console organization linked to a Max, Ultra or Team plan ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24). | Per the credits page, Max gets $100 a month, Ultra $200, Team $20 per Standard seat and $100 per Premium, pooled to $500. | CI: federation, no key. Otherwise a service account key in `ANTHROPIC_API_KEY` ([Authentication](https://platform.claude.com/docs/en/manage-claude/authentication), read 2026-11-24). | None. The credits exclude Claude Code and extra usage in the Claude apps ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24). | With no credits left, API requests stop until new ones arrive ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24). Leave auto-reload off. [More](detail/claude-api.md#guard). See [Git Crafter compute rules](https://github.com/SoulCraft-Org/git-crafter/blob/main/rules/compute.md). |

## Wiring

| Host | Plugs in as | Source |
| --- | --- | --- |
| Claude Desktop App, Code tab | Not available. The credits cover the API, Managed Agents, the Agent SDK and the Playground. Its "Doesn’t cover" row lists Claude Code. | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |
| Claude Desktop App, Cowork | Not available. Its "Doesn’t cover" row reads "Claude Code, extra usage in the Claude apps." | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |

<details>
<summary>Commands</summary>

```bash
ant auth status
```

```yaml
permissions:
  id-token: write
```

</details>

Guard and credits: [Claude API detail](detail/claude-api.md). Keyless CI: [Claude API CI](detail/claude-api-ci.md). Traps and sources: [Claude API traps and sources](detail/claude-api-traps.md).
