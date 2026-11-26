# Claude API: guard and credits

What the Claude API guide moved out of its page. Keyless CI: [Claude API CI](claude-api-ci.md). Traps and sources: [Claude API traps and sources](claude-api-traps.md). The diagram and wiring are in [Claude API](../claude-api.md).

## Guard

| Item | Detail | Source |
| --- | --- | --- |
| Covered | Claude API, Managed Agents, the Agent SDK and the Playground | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |
| Not covered | Claude Code, extra usage in the Claude apps, cloud platforms | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |
| Expiry | End of each billing cycle, no rollover | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |
| Order | Included credits first, then purchased ones. Auto-reload counts only the purchased balance | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |
| At zero | Requests stop, and usage is never charged to your plan. Buying credits or auto-reload removes the stop | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |
| Eligibility | Free, Pro and Enterprise are not eligible. New subscribers can claim after 7 days on an eligible plan | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers), read 2026-11-24 |

Read the Console's [Billing page](https://platform.claude.com/settings/billing) before a long run. It lists **Promotional credits** with amounts and expiry dates.
