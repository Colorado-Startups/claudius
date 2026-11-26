// The skills server (templates/claude/guides/skills-server): its catalog is built from plugin/skills, and its handler answers
// the stateless MCP 2026-07-28 calls for the skills extension. Offline: the handler is called with a Request, no socket.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildCatalog, parseFrontmatter, renderWorker } from '../templates/claude/guides/skills-server/build.mjs';
import { createHandler } from '../templates/claude/guides/skills-server/worker.mjs';

const V = '2026-07-28';
const catalog = buildCatalog('plugin/skills', 'claudius-skills');
const handle = createHandler(catalog);

// A request the way a 2026-07-28 client sends it: the version in the body and the header, the method in its header.
function call(method, params = {}, { headers = {}, version = V, verb = 'POST', body } = {}) {
  const meta = version ? { _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': { name: 't', version: '0' }, 'io.modelcontextprotocol/clientCapabilities': {} } } : {};
  const h = { 'content-type': 'application/json', ...(version ? { 'mcp-protocol-version': version } : {}), 'mcp-method': method, ...(params.uri && method === 'resources/read' ? { 'mcp-name': params.uri } : {}), ...headers };
  return handle(new Request('https://x.test/mcp', { method: verb, headers: h, body: verb === 'POST' ? (body ?? JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, ...meta } })) : undefined }));
}
const ok = async (res) => { assert.equal(res.status, 200); const j = await res.json(); assert.ok(j.result, JSON.stringify(j)); return j.result; };

test('catalog: every plugin skill is served, and each digest and size match the file on disk', () => {
  assert.deepEqual(catalog.skills.map((s) => s.name), ['equip', 'find-plugin', 'merge', 'plain-voice', 'plan', 'visibility']);
  for (const s of catalog.skills) for (const f of s.files) {
    const bytes = readFileSync(join('plugin/skills', s.name, f.path));
    assert.equal(f.size, bytes.length, f.path);
    assert.equal(f.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`, f.path);
    assert.equal(Buffer.from(f.text ?? f.blob, f.text !== undefined ? 'utf8' : 'base64').equals(bytes), true, f.path);
  }
  assert.ok(catalog.skills.find((s) => s.name === 'plan').files.some((f) => f.path === 'scripts/watch_workers.py'));
});

test('catalog: the frontmatter is verbatim, and a name that is not the folder name fails the build', () => {
  const equip = catalog.skills.find((s) => s.name === 'equip');
  assert.equal(equip.frontmatter.name, 'equip');
  assert.match(equip.frontmatter.description, /^Keeps every plugin, skill and connector on/);
  assert.throws(() => parseFrontmatter('---\nname: a\ndescription: >\n  folded\n---\n', 'x'), /flat/);
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  mkdirSync(join(dir, 'one'));
  writeFileSync(join(dir, 'one', 'SKILL.md'), '---\nname: two\ndescription: d\n---\nbody\n');
  assert.throws(() => buildCatalog(dir), /must equal the folder name/);
});

test('server/discover declares resources and the skills extension, with the version and cache fields', async () => {
  const r = await ok(await call('server/discover'));
  assert.equal(r.resultType, 'complete');
  assert.deepEqual(r.supportedVersions, [V]);
  assert.deepEqual(r.capabilities, { resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } });
  assert.equal(r._meta['io.modelcontextprotocol/serverInfo'].name, 'claudius-skills');
  assert.equal(typeof r.ttlMs, 'number');
  assert.equal(r.cacheScope, 'public');
});

test('skills/list lists every skill with a complete manifest, and skills/get returns the same entry', async () => {
  const list = await ok(await call('skills/list'));
  assert.equal(list.skills.length, 6);
  const plan = list.skills.find((s) => s.frontmatter.name === 'plan');
  assert.equal(plan.uri, 'skill://plan/SKILL.md');
  assert.deepEqual(plan.resources.map((r) => r.uri), ['skill://plan/SKILL.md', 'skill://plan/scripts/watch_workers.py']);
  for (const r of plan.resources) assert.match(r.digest, /^sha256:[0-9a-f]{64}$/);
  const got = await ok(await call('skills/get', { uri: 'skill://plan/SKILL.md' }));
  assert.deepEqual(got.skill, plan);
});

test('resources/read returns the bytes the manifest describes', async () => {
  const list = await ok(await call('skills/list'));
  for (const skill of list.skills) for (const res of skill.resources) {
    const r = await ok(await call('resources/read', { uri: res.uri }));
    const [c] = r.contents;
    assert.equal(c.uri, res.uri);
    const bytes = Buffer.from(c.text ?? '', 'utf8');
    assert.equal(bytes.length, res.size, res.uri);
    assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, res.digest, res.uri);
  }
  const r = await ok(await call('resources/read', { uri: 'skill://equip/SKILL.md' }));
  assert.equal(r.contents[0].mimeType, 'text/markdown');
});

test('an unknown skill or resource is -32602, not a crash', async () => {
  for (const [m, p] of [['skills/get', { uri: 'skill://nope/SKILL.md' }], ['resources/read', { uri: 'skill://equip/missing.md' }]]) {
    const j = await (await call(m, p)).json();
    assert.equal(j.error.code, -32602, m);
  }
});

test('headers are checked: a version or method that disagrees with the body is 400 -32020, an unknown version 400 -32022', async () => {
  let res = await call('skills/list', {}, { headers: { 'mcp-method': 'resources/list' } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32020);
  res = await call('skills/list', {}, { headers: { 'mcp-protocol-version': '2025-06-18' } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32020);
  res = await call('resources/read', { uri: 'skill://equip/SKILL.md' }, { headers: { 'mcp-name': 'skill://equip/other.md' } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32020);
  res = await call('skills/list', {}, { version: '2099-01-01' });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.error.code, -32022);
  assert.deepEqual(j.error.data.supported, [V]);
});

test('Mcp-Name may be base64 encoded', async () => {
  const uri = 'skill://equip/SKILL.md';
  await ok(await call('resources/read', { uri }, { headers: { 'mcp-name': `=?base64?${Buffer.from(uri).toString('base64')}?=` } }));
});

test('a method the server does not implement is 404 -32601 (tools are not declared)', async () => {
  const res = await call('tools/list');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, -32601);
});

test('a browser Origin that is not listed is 403, a listed one passes, and GET is 405', async () => {
  assert.equal((await call('skills/list', {}, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('skills/list', {}, { headers: { origin: 'https://claude.ai' } })).status, 200);
  const custom = createHandler(catalog, { allowedOrigins: ['https://app.example'] });
  const req = new Request('https://x.test/mcp', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', 'mcp-protocol-version': V, 'mcp-method': 'ping' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': V } } }) });
  assert.equal((await custom(req)).status, 200);
  assert.equal((await call('x', {}, { verb: 'GET' })).status, 405);
});

test('a notification gets 202, and bad JSON is a parse error', async () => {
  const note = await call('notifications/initialized', {}, { body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(note.status, 202);
  const bad = await call('skills/list', {}, { body: '{' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
});

test('an older client that calls initialize first gets the same skills, without the new result fields', async () => {
  const init = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old', version: '1' } } }) }));
  const r = (await init.json()).result;
  assert.equal(r.protocolVersion, '2025-06-18');
  assert.ok(r.capabilities.extensions['io.modelcontextprotocol/skills']);
  const list = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'skills/list' }) }));
  const lr = (await list.json()).result;
  assert.equal(lr.skills.length, 6);
  assert.equal(lr.resultType, undefined);
  assert.equal(lr.ttlMs, undefined);
});

test('the built module is one file that exports a fetch handler, with the catalog inside', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-build-'));
  const file = join(dir, 'worker.mjs');
  writeFileSync(file, renderWorker(catalog));
  // A separate node process loads the file as a Cloudflare Worker module would: only the file, nothing from this repo.
  const script = `import w from ${JSON.stringify(pathToFileURL(file).href)};
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '${V}' } } });
    const res = await w.fetch(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': '${V}', 'mcp-method': 'skills/list' }, body }), {});
    console.log((await res.json()).result.skills.length);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '6');
});
