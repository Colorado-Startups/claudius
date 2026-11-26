# Skills server

A dependency-free MCP server that serves a folder of Agent Skills ([Skills over MCP](https://modelcontextprotocol.io/extensions/skills/overview), MCP revision 2026-07-28). It keeps no session and no storage. It is built for a Cloudflare Worker. The handler uses only the web-standard `Request` and `Response`. The whole catalog sits in one script, which must fit your plan's script size limit.

```mermaid
flowchart LR
  S["skills folder<br/>(SKILL.md + files)"] -->|build.mjs| W["worker.mjs<br/>one file"]
  W --> C["custom connector"]
  C -->|server/discover<br/>skills/list, skills/get<br/>resources/read| H["Claude"]
```

| File | Job |
| --- | --- |
| [`worker.mjs`](worker.mjs) | The handler. `createHandler(catalog)` returns `fetch(request, env)` |
| [`build.mjs`](build.mjs) | Reads the folder, hashes every file except dotfiles, `node_modules` and `__pycache__` (sha256) and writes `catalog.json` plus one deployable `worker.mjs` |
| [`tests/skills-server.test.mjs`](https://github.com/Colorado-Startups/claudius/blob/main/tests/skills-server.test.mjs) | Builds this repo's own `plugin/skills` and calls every method |

## Use it

```bash
node build.mjs path/to/skills dist my-skills   # skills folder, output folder, server name
```

`dist/worker.mjs` is the whole server. On Cloudflare, `wrangler deploy dist/worker.mjs --name my-skills --compatibility-date <yyyy-mm-dd>` uploads it. Then add the URL as a custom connector (the connector settings of your Claude app). The [announcement](https://claude.com/resources/articles/skills-over-mcp-tasks-and-more) (read 2026-11-26) does not say where Claude lists the skills a connector brings. Check your session's skill list.

## What it answers

| Call | Reply |
| --- | --- |
| `server/discover` | Version `2026-07-28`, capabilities `resources` and `io.modelcontextprotocol/skills`, server name |
| `skills/list`, `skills/get` | One entry per skill: `uri`, the `frontmatter`, and every file with its `sha256` digest and size |
| `resources/read` | The file text, or base64 for a binary file |
| `resources/list` | Every file, named by its path, and a `SKILL.md` by its skill's name and description |
| `initialize`, `ping` | A shim for a client on an older revision, which sets no session id. `ping` is removed in 2026-07-28 |
| anything else | 404 with `-32601`, or 200 with `-32601` on the legacy path |

The handler checks what the [transport page](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (read 2026-11-26) requires: `MCP-Protocol-Version` equal to the version in `_meta`, `Mcp-Method` equal to the method, and `Mcp-Name` equal to `params.uri` on `resources/read` (`-32020` on a mismatch, `-32022` for another version). On the 2026-07-28 path, a request without `protocolVersion` or `clientCapabilities` in `_meta` gets `-32602`. It refuses a browser `Origin` unless it is `https://claude.ai`, `https://claude.com` or in the `ALLOWED_ORIGINS` variable (comma separated). The server sends no CORS headers, so a browser page cannot read its replies.

## Limits

| Limit | Why |
| --- | --- |
| Public and read-only | There is no sign-in. Serve only skills you would publish, such as the ones in a public repo |
| One skill is at most 512 files and 16 MiB | The [extension's limit](https://modelcontextprotocol.io/extensions/skills/overview) (read 2026-11-26). `build.mjs` fails above it |
| Frontmatter is flat `key: value` | `build.mjs` fails on a folded or nested value instead of reading it half right. A value that YAML would read another way, such as `1.10`, `True` or `1e3`, fails the build and must be quoted |
| File paths use letters, digits, `.`, `_`, `-` and `/`, and no symbolic link | `build.mjs` fails otherwise, so a URI never needs encoding and a link never leaks a file from outside the folder |
| Tested offline only | The test calls the handler directly. No Claude client has been run against it. The `initialize` shim is unverified against one |

Rebuild and redeploy when a skill changes. The catalog is baked into `worker.mjs`, so the digests always match the files it serves.
