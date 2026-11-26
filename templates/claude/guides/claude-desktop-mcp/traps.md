# Claude Desktop MCP: traps and sources

What goes wrong with each route, and the pages this guide read. The routes are in [Claude Desktop MCP](../claude-desktop-mcp.md).

## Traps

| Trap | Detail |
| --- | --- |
| A loopback or LAN URL as a connector | Claude connects to a custom connector from Anthropic's cloud, not from your computer. The server must be reachable from the public internet on port 443 (source: [custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)). Use the bridge, or the MCP tunnels page the [unlisted connector page](https://claude.com/docs/connectors/custom/add-unlisted) links |
| A URL with its own port | Per the same support page, Claude can't connect to a URL that names a port other than 443 |
| Free plan | Per the [unlisted connector page](https://claude.com/docs/connectors/custom/add-unlisted), the Free plan allows one custom connector |
| Changing a connector's sign-in | Authentication settings are fixed once added. Remove the connector, add it again, and members reconnect |
| A shared key on Team or Enterprise | A request-header credential gives every member who connects that credential's access. Use a key limited to what members should reach |
| `~/.claude.json` for Cowork | Cowork doesn't read Claude Code's config. A server there reaches the Code tab only |
| The same URL in two places | A server added in Claude Code wins over a connector with the same URL. Then the connector shows as hidden ([Claude Code MCP](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claude-ai)). |
| An API key login | Claude Code in the terminal fetches connectors only under a Claude subscription login. `ANTHROPIC_API_KEY` or `apiKeyHelper` turns them off |
| Extensions turned off | An organization can turn extensions off or limit them. Then Extensions doesn't appear in settings |
| Always allow on write tools | Always allow skips the prompt for good. Keep it to read-only tools on servers you trust |
| An app that needs a token | The bridge sends no auth header. It suits apps that serve MCP on loopback without one |

## Sources

<details>
<summary>Pages read and their dates</summary>

| Page | Read |
| --- | --- |
| [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted) | 2026-11-20 |
| [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) | 2026-11-24 |
| [Get started with connectors](https://claude.com/docs/connectors/getting-started) | 2026-11-20 |
| [Build a desktop extension with MCPB](https://claude.com/docs/connectors/building/mcpb) | 2026-11-20 |
| [MCPB README and v0.4 manifest schema](https://github.com/modelcontextprotocol/mcpb) | 2026-11-20 |
| [MCPB CLI](https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md) | 2026-11-20 |
| [Claude Code: connect to MCP servers](https://code.claude.com/docs/en/mcp) | 2026-11-20 |
| [Claude Code: the desktop app](https://code.claude.com/docs/en/desktop) | 2026-11-24 |

</details>
