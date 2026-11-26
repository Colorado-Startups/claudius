# Claude API: traps and sources

What goes wrong with the Claude API, and the pages this guide read. The steps are in [Claude API CI](claude-api-ci.md).

## Traps

| Trap | What happens |
| --- | --- |
| A leftover key | A key left in `ANTHROPIC_API_KEY` silently overrides federation ([WIF][wif], read 2026-11-24). So do the action's `anthropic_api_key` and `claude_code_oauth_token` inputs ([Setup][setup], read 2026-11-24) |
| Plan credits and Claude Code | A run on an organization holding only these credits fails at once: `Credit balance too low` ([API credits][credits], read 2026-11-24) |
| One organization per plan | A plan links to one Console organization, and you cannot change it yourself. Link the one you build in ([API credits][credits], read 2026-11-24) |
| One shared balance | Every key and workspace draws from one balance. Give a project its own workspace and spend limit ([API credits][credits], read 2026-11-24) |
| Bought credits | They expire one year after purchase, and the date cannot be extended ([Pay for API usage][pay], read 2026-11-24) |
| Immutable subject | GitHub repos created after July 15, 2026 get a `sub` with owner and repo IDs ([OIDC][oidc], read 2026-11-24). Seen on this repo on 2026-11-23: `repo:<owner>@<id>/<repo>@<id>:ref:...`, while the wizard filled in the old form, so each exchange failed `match_subject_prefix`. `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` prints the prefix to use |
| Single-use tokens | A JWT with a `jti` claim exchanges once. A retry fails with `jti_reused` ([WIF][wif], read 2026-11-24) |
| Token lifetime | Per the WIF page, a rule's lifetime runs from 60 to 86,400 seconds, default 3,600. The SDK refreshes before expiry ([WIF][wif], read 2026-11-24) |
| Workspace ID | A rule that covers more than one workspace needs the workspace ID in each exchange. A key with no workspace scope needs the `anthropic-workspace-id` header. Without it the API returns 400 ([Authentication][auth], read 2026-11-24) |
| Inline comment classification | `classify_inline_comments` needs `anthropic_api_key`, so federation skips it ([Setup][setup], read 2026-11-24) |
| Expiry is set once | A key's expiry is fixed at creation. An expired key returns 401 and cannot be reactivated ([Authentication][auth], read 2026-11-24) |
| Message Batches | Per the credits page, they cost 50 percent less. ([API credits][credits], read 2026-11-24) |

## Sources

<details>
<summary>Pages read and their dates</summary>

| Page | Read |
| --- | --- |
| [API credits for Max, Ultra and Team plans][credits] | 2026-11-24 |
| [Workload identity federation][wif] | 2026-11-24 |
| [Authentication][auth] | 2026-11-24 |
| [How do I pay for my Claude API usage][pay] | 2026-11-24 |
| [claude-code-action setup][setup] | 2026-11-24 |
| [GitHub OpenID Connect][oidc] | 2026-11-24 |

</details>

[wif]: https://platform.claude.com/docs/en/manage-claude/workload-identity-federation
[auth]: https://platform.claude.com/docs/en/manage-claude/authentication
[credits]: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
[pay]: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
[setup]: https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md
[oidc]: https://docs.github.com/en/actions/concepts/security/openid-connect
