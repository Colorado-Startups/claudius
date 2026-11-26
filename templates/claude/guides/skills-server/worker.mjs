// A stateless MCP server that serves Agent Skills (extension io.modelcontextprotocol/skills, MCP revision 2026-07-28).
// No dependencies, no storage, no session. It runs in any runtime with the web-standard Request and Response (a
// Cloudflare Worker, Deno, Node 18+). build.mjs adds the catalog and the default export; tests/skills-server.test.mjs
// runs it. Sources: modelcontextprotocol.io/extensions/skills, /specification/2026-07-28/basic/transports/streamable-http.

const VERSION = '2026-07-28';
// Older revisions are answered through a small shim (initialize, ping, notifications), so a client that has not moved yet can connect.
const LEGACY = ['2025-11-25', '2025-06-18'];
const SKILLS_EXT = 'io.modelcontextprotocol/skills';
const META = 'io.modelcontextprotocol/protocolVersion';
const TTL_MS = 300000;
// A browser origin is refused unless listed (the spec's DNS-rebinding rule). A call from a server has no Origin header.
const DEFAULT_ORIGINS = ['https://claude.ai', 'https://claude.com'];

const text = (status, body, headers = {}) => new Response(body, { status, headers });
const json = (status, body) => text(status, JSON.stringify(body), { 'content-type': 'application/json' });
// A reply to a message with no usable id carries no id (the base protocol forbids a null id).
const fail = (status, id, code, message, data) => json(status, { jsonrpc: '2.0', ...(id == null ? {} : { id }), error: { code, message, ...(data ? { data } : {}) } });

// Mcp-Name may arrive as =?base64?...?= when the value is not plain ASCII.
// A value that does not decode is null, which never equals a URI, so the caller answers with a header mismatch.
function headerValue(v) {
  const m = /^=\?base64\?(.*)\?=$/.exec(v ?? '');
  if (!m) return v;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))); } catch { return null; }
}

export function createHandler(catalog, { allowedOrigins = [] } = {}) {
  const origins = [...DEFAULT_ORIGINS, ...allowedOrigins];
  const skills = catalog.skills.map((s) => {
    const uri = `skill://${s.name}/SKILL.md`;
    return {
      ...s,
      entry: { uri, frontmatter: s.frontmatter, resources: s.files.map((f) => ({ uri: `skill://${s.name}/${f.path}`, digest: f.digest, size: f.size })) },
    };
  });
  const byUri = new Map(skills.map((s) => [s.entry.uri, s]));
  const files = new Map(skills.flatMap((s) => s.files.map((f) => [`skill://${s.name}/${f.path}`, f])));
  // A SKILL.md resource carries the skill's name and description; any other file its path.
  const resourceName = (uri) => { const s = byUri.get(uri); return s ? { name: s.frontmatter.name, description: s.frontmatter.description } : { name: uri.slice('skill://'.length) }; };
  const info = catalog.serverInfo ?? { name: 'skills-server', version: '1.0.0' };
  // Every result names the server in _meta, as the base protocol asks; cache fields are for the cacheable results.
  const meta = { _meta: { 'io.modelcontextprotocol/serverInfo': info } };
  const cache = { ttlMs: TTL_MS, cacheScope: 'public', ...meta };

  // Each method returns a result object, or throws {code, message} for a JSON-RPC error.
  const methods = Object.assign(Object.create(null), {
    'server/discover': () => ({
      supportedVersions: [VERSION],
      capabilities: { resources: {}, extensions: { [SKILLS_EXT]: {} } },
      instructions: 'Each skill is read with skills/get, then its files with resources/read. Every file carries a sha256 digest and a size.',
      ...cache,
    }),
    'skills/list': () => ({ skills: skills.map((s) => s.entry), ...cache }),
    'skills/get': (p) => {
      const s = byUri.get(p?.uri);
      if (!s) throw { code: -32602, message: `Unknown skill: ${p?.uri}` };
      return { skill: s.entry, ...cache };
    },
    'resources/list': () => ({ resources: [...files.entries()].map(([uri, f]) => ({ uri, ...resourceName(uri), mimeType: f.mimeType, size: f.size })), ...cache }),
    'resources/read': (p) => {
      const f = files.get(p?.uri);
      if (!f) throw { code: -32602, message: `Unknown resource: ${p?.uri}` };
      return { contents: [{ uri: p.uri, mimeType: f.mimeType, ...(f.text !== undefined ? { text: f.text } : { blob: f.blob }) }], ...cache };
    },
  });
  // ping was removed in 2026-07-28; the older-revision shim still answers it.
  const legacyOnly = Object.assign(Object.create(null), { ping: () => ({}) });

  return async function fetch(request, env = {}) {
    const extra = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    const origin = request.headers.get('origin');
    if (origin && ![...origins, ...extra].includes(origin)) return fail(403, null, -32600, 'Origin not allowed');
    if (request.method !== 'POST') return text(405, 'POST only', { allow: 'POST' });

    let msg;
    try { msg = await request.json(); } catch { return fail(400, null, -32700, 'Parse error'); }
    if (!msg || Array.isArray(msg) || typeof msg !== 'object' || typeof msg.method !== 'string') return fail(400, null, -32600, 'Invalid request');
    const { id, method, params } = msg;
    if (id === undefined) return text(202, ''); // a notification takes no reply
    if (typeof id !== 'string' && typeof id !== 'number') return fail(400, null, -32600, 'Invalid request: id must be a string or a number');

    const header = request.headers.get(`mcp-protocol-version`);
    const body = params?._meta?.[META];
    // Legacy: an initialize call, or a request that names an older revision and carries no per-request version.
    // A request with no version anywhere is the 2025-03-26 form, which the transport page lets a server treat as legacy.
    const legacy = method === 'initialize' || (body === undefined && (header === null || LEGACY.includes(header)));
    if (!legacy) {
      const caps = params?._meta?.['io.modelcontextprotocol/clientCapabilities'];
      if (typeof body !== 'string' || !caps || typeof caps !== 'object' || Array.isArray(caps)) return fail(400, id, -32602, 'Invalid params: _meta needs io.modelcontextprotocol/protocolVersion and io.modelcontextprotocol/clientCapabilities');
      if (!header || header !== body) return fail(400, id, -32020, `Header mismatch: MCP-Protocol-Version ${JSON.stringify(header)} does not match _meta ${JSON.stringify(body)}`);
      if (body !== VERSION) return fail(400, id, -32022, `Unsupported protocol version ${JSON.stringify(body)}`, { supported: [VERSION] });
      if (request.headers.get('mcp-method') !== method) return fail(400, id, -32020, 'Header mismatch: Mcp-Method does not match the request method');
      if (method === 'resources/read' && headerValue(request.headers.get('mcp-name')) !== params?.uri) return fail(400, id, -32020, 'Header mismatch: Mcp-Name does not match params.uri');
    }

    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      return json(200, { jsonrpc: '2.0', id, result: {
        protocolVersion: LEGACY.includes(asked) ? asked : LEGACY[0],
        capabilities: methods['server/discover']().capabilities, serverInfo: info,
      } });
    }
    const run = methods[method] ?? (legacy ? legacyOnly[method] : undefined);
    if (!run) return fail(legacy ? 200 : 404, id, -32601, `Method not found: ${method}`);
    try {
      const result = run(params);
      if (legacy) { delete result.ttlMs; delete result.cacheScope; } else result.resultType = 'complete';
      return json(200, { jsonrpc: '2.0', id, result });
    } catch (e) {
      if (typeof e?.code !== 'number') throw e;
      return fail(200, id, e.code, e.message);
    }
  };
}
