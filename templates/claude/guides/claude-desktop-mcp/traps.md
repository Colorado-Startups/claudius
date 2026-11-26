# Claude Desktop MCP: traps and sources

What goes wrong with each route, and the pages this guide read. The routes are in [Claude Desktop MCP](../claude-desktop-mcp.md).

## Traps

| Trap | Detail |
| --- | --- |
| A loopback or LAN URL as a connector | Claude connects from Anthropic's cloud, not from your device, and the server must be reachable on port 443. A URL that names another port does not connect ([Connectors][conn], read 2026-11-26). Use the bridge, or [MCP tunnels](https://claude.com/docs/connectors/mcp-tunnels/overview) for a private network ([Add unlisted][unlisted], read 2026-11-26) |
| Free plan | The Free plan allows one custom connector ([Add unlisted][unlisted], read 2026-11-26) |
| Changing a connector | Authentication settings and the URL cannot change after adding. Remove the connector, add it again, and members reconnect ([Add unlisted][unlisted], read 2026-11-26) |
| A shared credential on Team or Enterprise | Everyone who uses the connector reaches the service with the same credential ([Connectors][conn], read 2026-11-26). Use a key limited to what members should reach |
| `~/.claude.json` for Cowork | Cowork takes its connectors from your claude.ai account, not from Claude Code's config ([Desktop docs][desktop], read 2026-11-26) |
| The same URL in two places | A server added in Claude Code takes precedence over a claude.ai connector at the same URL, and `/mcp` lists the connector as hidden ([Claude Code MCP][mcp], read 2026-11-26) |
| An API key login | Claude Code fetches claude.ai connectors only under a claude.ai subscription login. They are not loaded while `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `apiKeyHelper` is active ([Claude Code MCP][mcp], read 2026-11-26) |
| Extensions turned off | An organization can turn extensions off or limit them. Then Extensions does not appear in settings ([Add unlisted][unlisted], read 2026-11-26) |
| Always allow on write tools | Select Always allow only for trusted servers ([Add unlisted][unlisted], read 2026-11-26) |
| An empty skill list from a server | On Team, an admin enables Skills over MCP first. Enterprise is coming ([announcement][skills], read 2026-11-26) |
| A server on revision 2026-07-28 behind the bridge | That revision removes `initialize` and `Mcp-Session-Id`, which the bridge needs ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), read 2026-11-26). Read from the code, not run ([#162](https://github.com/Colorado-Startups/claudius/issues/162)) |
| An app that needs a token | The bridge sends no auth header |

## Sources

| Page | Read |
| --- | --- |
| [Add a connector that isn't in the directory][unlisted] | 2026-11-26 |
| [Get started with custom connectors using remote MCP][conn] | 2026-11-26 |
| [Build a desktop extension with MCPB](https://claude.com/docs/connectors/building/mcpb) | 2026-11-26 |
| [MCPB README](https://github.com/modelcontextprotocol/mcpb) and [manifest spec](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md) | 2026-11-26 |
| [MCP servers can now ship skills, run tasks, and more with Claude][skills] | 2026-11-26 |
| [MCP Skills extension](https://modelcontextprotocol.io/extensions/skills/overview), [Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview), [Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation) and [File Uploads](https://github.com/modelcontextprotocol/experimental-ext-file-uploads) | 2026-11-26 |
| [Claude Code: connect to MCP servers][mcp] | 2026-11-26 |
| [Claude Code: the desktop app][desktop] | 2026-11-26 |

[skills]: https://claude.com/resources/articles/skills-over-mcp-tasks-and-more
[conn]: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
[unlisted]: https://claude.com/docs/connectors/custom/add-unlisted
[mcp]: https://code.claude.com/docs/en/mcp
[desktop]: https://code.claude.com/docs/en/desktop
