# Claude Desktop: an app that listens only on this computer

The desktop-extension route for a server that answers on loopback. The routes for other servers are in [Claude Desktop MCP](../claude-desktop-mcp.md).

## Set up the bridge

A connector can't reach `127.0.0.1`, so a loopback app needs a desktop extension. The [loopback-bridge/](../loopback-bridge/) template is one: a stdio MCP server with no dependencies that forwards to the app's Streamable HTTP endpoint.

1. Copy `loopback-bridge/` (`manifest.json` and `server/bridge.js`).
2. In `manifest.json`, replace `<app-id>`, `<App name>` and `<your name>`. Set `<port>` to the port the app's own docs give.
3. Pack it from inside the folder: `zip -r ../app-bridge.mcpb manifest.json server`. A `.mcpb` file is a zip archive with `manifest.json` at its root, per the [MCPB README](https://github.com/modelcontextprotocol/mcpb). The [MCPB CLI](https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md)'s `mcpb pack` also works and validates the manifest first.
4. Install it: on macOS run `open -a Claude app-bridge.mcpb`, the command form of double-clicking it. Or drag the file onto Settings > Extensions. Review the preview and select Install.
5. Open the app, then start a new Code tab or Cowork session.

<details>
<summary>Bridge behavior and how it was tested</summary>

| Bridge behavior | Detail |
| --- | --- |
| Loopback only | It forwards only to `127.0.0.1`, `localhost` or `[::1]`. Any other host, or a missing `MCP_URL`, exits with code 2 |
| No redirects | It never follows a redirect. A `3xx` reply fails the request, as a closed app does |
| App closed | It still starts. A tools list request returns no tools, and a tool call returns "`<App name>` is not running at `<url>`. Open it, then try again." |
| App opens later | It retries every 5 seconds (source: the template's code), then sends `notifications/tools/list_changed` so the tools appear |
| App restarts | A `404` on the old session opens a new one and retries the request once |
| Runtime | Node 18 or later, from `fetch` alone. The MCPB README says Node ships with Claude for macOS and Windows |
| Tested | On 2026-11-20, against a desktop app's loopback MCP server. Its tools listed, a closed app gave the error above, and a non-loopback URL exited with code 2. A mock loopback server gave the same results the same day. |

</details>
