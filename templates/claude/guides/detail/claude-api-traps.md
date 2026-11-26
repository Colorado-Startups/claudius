# Claude API: traps and sources

What goes wrong with the Claude API, and the pages this guide read. The steps are in [Claude API CI](claude-api-ci.md).

## Traps

| Trap | What happens |
| --- | --- |
| A leftover key | A key left in `ANTHROPIC_API_KEY` silently overrides federation ([WIF][wif], read 2026-11-26). So does a static `anthropic_api_key` or `claude_code_oauth_token` input on the action ([Setup][setup], read 2026-11-26) |
| Plan credits and Claude Code | An organization that holds only plan credits and sends a request they do not cover, such as a Claude Code session, gets `Credit balance too low` ([API credits][credits], read 2026-11-26) |
| One organization per plan | A plan links to one Console organization, and you cannot change it yourself ([API credits][credits], read 2026-11-26) |
| One shared balance | Every key and workspace in the organization draws from one balance. Give a project its own workspace and spend limit ([API credits][credits], read 2026-11-26) |
| Bought credits | Prepaid credits expire one year after purchase, and the date cannot be extended ([Pay for API usage][pay], read 2026-11-26) |
| Immutable subject | GitHub repositories created after July 15, 2026 use a default `sub` claim that includes owner and repository IDs ([OIDC][oidc], read 2026-11-26). A rule written for the old form can fail to match, so check the `sub` your job presents against the rule's subject prefix |
| Single-use tokens | An identity token with a `jti` claim exchanges once. A retry with the same token fails with `jti_reused` ([WIF][wif], read 2026-11-26) |
| Token lifetime | A rule's `token_lifetime_seconds` runs from 60 to 86,400, default 3,600. The SDK refreshes before expiry ([WIF][wif], read 2026-11-26) |
| Workspace ID | A rule that covers more than one workspace needs the workspace ID in each exchange ([WIF][wif], read 2026-11-26). A key with no workspace scope needs the `anthropic-workspace-id` header, or the API returns 400 ([Authentication][auth], read 2026-11-26) |
| Inline comment classification | `classify_inline_comments` currently needs `anthropic_api_key`, so federation skips it ([Setup][setup], read 2026-11-26) |
| Expiry is set once | A key's expiry is fixed at creation. An expired key returns 401 and cannot be reactivated ([Authentication][auth], read 2026-11-26) |
| Message Batches | Per the credits page, the Message Batches API costs 50 percent less ([API credits][credits], read 2026-11-26) |

## Sources

| Page | Read |
| --- | --- |
| [API credits for Max, Ultra and Team plans][credits] | 2026-11-26 |
| [Workload identity federation][wif] | 2026-11-26 |
| [Authentication][auth] | 2026-11-26 |
| [How do I pay for my Claude API usage][pay] | 2026-11-26 |
| [claude-code-action setup][setup] and its `action.yml` at v1.0.290 | 2026-11-26 |
| [GitHub OpenID Connect][oidc] | 2026-11-26 |
| [Claude Code CLI reference][cli] | 2026-11-26 |

[wif]: https://platform.claude.com/docs/en/manage-claude/workload-identity-federation
[auth]: https://platform.claude.com/docs/en/manage-claude/authentication
[credits]: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
[pay]: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
[setup]: https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md
[oidc]: https://docs.github.com/en/actions/concepts/security/openid-connect
[cli]: https://code.claude.com/docs/en/cli-reference
