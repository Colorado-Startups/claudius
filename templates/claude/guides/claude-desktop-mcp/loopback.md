# Claude Desktop: an app that listens only on this computer

A connector cannot reach `127.0.0.1`, because Claude connects from Anthropic's cloud ([Connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), read 2026-11-26). A desktop extension runs on your computer, so it can. The [loopback-bridge/](../loopback-bridge/) template is one: a stdio MCP server with no dependencies that forwards to the app's Streamable HTTP endpoint on loopback.

## Set up the bridge

1. Copy `loopback-bridge/` (`manifest.json` and `server/bridge.js`).
2. In `manifest.json`, replace `<app-id>`, `<App name>` and `<your name>`. Set `<port>` to the port the app's own docs give.
3. Pack it with the MCPB CLI: `mcpb pack` from inside the folder. A `.mcpb` file is a zip archive of the server and its `manifest.json` ([MCPB page](https://claude.com/docs/connectors/building/mcpb), read 2026-11-26).
4. Install it: double-click the file, or drag it onto Settings > Extensions in the desktop app. Review the preview and select Install ([Add unlisted](https://claude.com/docs/connectors/custom/add-unlisted), read 2026-11-26).
5. Open the app, then start a new session. The vendor pages do not say which desktop sessions see an extension, so check yours.

## Bridge behavior

| Behavior | Detail |
| --- | --- |
| Loopback only | It forwards only to `127.0.0.1` or `[::1]`, over plain `http:`, with no credentials in the URL. Anything else, or a missing `MCP_URL`, exits with code 2 |
| No redirects | A `3xx` reply fails the request. The test in `tests/bridge.test.mjs` shows the redirect target gets no request |
| No secret | It reads two settings, `MCP_URL` and `MCP_APP_NAME`, sends no auth header and writes nothing to stderr but a fixed message and the refused host name |
| App closed | It still starts. A tools list request returns no tools, and a tool call returns "`<App name>` is not running at `<url>`. Open it, then try again." |
| App opens later | It retries every 5 seconds, then sends `notifications/tools/list_changed` so the tools appear |
| App restarts | A `404` on the old session opens a new one and retries the request once |
| Runtime | Node 18 or later. Node ships with Claude for macOS and Windows ([MCPB README](https://github.com/modelcontextprotocol/mcpb), read 2026-11-26) |

It suits apps that serve MCP on loopback with no token.
