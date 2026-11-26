// The skills server (templates/claude/guides/skills-server): its catalog is built from plugin/skills, and its handler answers
// the stateless MCP 2026-07-28 calls for the skills extension. Offline: the handler is called with a Request, no socket.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildCatalog, parseFrontmatter, renderWorker } from '../templates/claude/guides/skills-server/build.mjs';
import { createHandler } from '../templates/claude/guides/skills-server/worker.mjs';

const V = '2026-07-28';
const catalog = buildCatalog('plugin/skills', 'claudius-skills');
const handle = createHandler(catalog);
// The skills on disk, so adding a skill to the plugin does not break these tests.
const NAMES = readdirSync('plugin/skills').filter((n) => existsSync(join('plugin/skills', n, 'SKILL.md'))).sort();

// A request the way a 2026-07-28 client sends it: the version in the body and the header, the method in its header.
function call(method, params = {}, { headers = {}, version = V, verb = 'POST', body } = {}) {
  const meta = version ? { _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': { name: 't', version: '0' }, 'io.modelcontextprotocol/clientCapabilities': {} } } : {};
  const h = { 'content-type': 'application/json', ...(version ? { 'mcp-protocol-version': version } : {}), 'mcp-method': method, ...(params.uri && method === 'resources/read' ? { 'mcp-name': params.uri } : {}), ...headers };
  return handle(new Request('https://x.test/mcp', { method: verb, headers: h, body: verb === 'POST' ? (body ?? JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, ...meta } })) : undefined }));
}
const ok = async (res) => { assert.equal(res.status, 200); const j = await res.json(); assert.ok(j.result, JSON.stringify(j)); return j.result; };

test('catalog: every plugin skill is served, and each digest and size match the file on disk', () => {
  assert.ok(NAMES.length >= 6);
  assert.deepEqual(catalog.skills.map((s) => s.name), NAMES);
  for (const s of catalog.skills) for (const f of s.files) {
    const bytes = readFileSync(join('plugin/skills', s.name, f.path));
    assert.equal(f.size, bytes.length, f.path);
    assert.equal(f.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`, f.path);
    assert.equal(Buffer.from(f.text ?? f.blob, f.text !== undefined ? 'utf8' : 'base64').equals(bytes), true, f.path);
  }
  assert.ok(catalog.skills.find((s) => s.name === 'plan').files.some((f) => f.path === 'scripts/watch_workers.py'));
});

// A skill folder in a temp dir: flat frontmatter with every scalar kind, a CRLF SKILL.md, a PNG, and a file with a BOM.
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00]);

test('catalog: frontmatter scalars, CRLF, a binary file and a BOM file keep their exact bytes', async () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom file\n')]);
  const dir = fixture({
    'demo/SKILL.md': '---\r\nname: demo\r\ndescription: "Says: hello"\r\nlicense: Apache-2.0\r\nbeta: true\r\nrank: 3\r\n---\r\nBody\r\n',
    'demo/assets/logo.png': PNG,
    'demo/notes/bom.md': bom,
  });
  const cat = buildCatalog(dir, 'fx');
  assert.deepEqual(cat.skills[0].frontmatter, { name: 'demo', description: 'Says: hello', license: 'Apache-2.0', beta: true, rank: 3 });
  const h = createHandler(cat);
  const r = (m, p) => h(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': V, 'mcp-method': m, ...(p.uri && m === 'resources/read' ? { 'mcp-name': p.uri } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: { ...p, _meta: { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientCapabilities': {} } } }) })).then((x) => x.json());
  const list = (await r('skills/list', {})).result.skills[0];
  assert.equal(list.resources.length, 3);
  for (const [uri, bytes] of [['skill://demo/assets/logo.png', PNG], ['skill://demo/notes/bom.md', bom]]) {
    const entry = list.resources.find((x) => x.uri === uri);
    assert.equal(entry.size, bytes.length);
    assert.equal(entry.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    const c = (await r('resources/read', { uri })).result.contents[0];
    const got = c.text !== undefined ? Buffer.from(c.text, 'utf8') : Buffer.from(c.blob, 'base64');
    assert.equal(got.equals(bytes), true, uri);
  }
  assert.equal((await r('resources/read', { uri: 'skill://demo/assets/logo.png' })).result.contents[0].blob, PNG.toString('base64'));
});

test('catalog: a bad folder fails the build, never a half-served skill', () => {
  const md = (name) => `---\nname: ${name}\ndescription: d\n---\nx\n`;
  assert.throws(() => buildCatalog(fixture({ 'one/SKILL.md': md('two') })), /must equal the folder name/);
  assert.throws(() => buildCatalog(fixture({ 'Bad_Name/SKILL.md': md('Bad_Name') })), /not a valid skill name/);
  assert.throws(() => buildCatalog(fixture({ 'a/SKILL.md': md('a'), 'a/my file.md': 'x' })), /use only letters/);
  assert.throws(() => buildCatalog(fixture({ 'a/SKILL.md': '---\nname: a\ndescription: >\n  folded\n---\n' })), /flat/);
  assert.throws(() => buildCatalog(fixture({ 'a/SKILL.md': '---\nname: a\ndescription: "C:\\path"\n---\n' })), /bad double-quoted value/);
  assert.throws(() => buildCatalog(fixture({})), /no skill folders/);
  const many = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`a/f${i}.md`, 'x']));
  assert.throws(() => buildCatalog(fixture({ 'a/SKILL.md': md('a'), ...many })), /over the 512 limit/);
  assert.throws(() => buildCatalog(fixture({ 'a/SKILL.md': md('a'), 'a/big.bin': Buffer.alloc(16 * 1024 * 1024) })), /over the 16777216 limit/);
  const linked = fixture({ 'a/SKILL.md': md('a'), 'shared.md': 'x' });
  symlinkSync(join(linked, 'shared.md'), join(linked, 'a', 'link.md'));
  assert.throws(() => buildCatalog(linked), /symbolic link/);
  const linkedSkill = fixture({ 'a/SKILL.md': md('a'), 'shared.md': md('a') });
  rmSync(join(linkedSkill, 'a', 'SKILL.md'));
  symlinkSync(join(linkedSkill, 'shared.md'), join(linkedSkill, 'a', 'SKILL.md'));
  assert.throws(() => buildCatalog(linkedSkill), /symbolic link/);
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
  assert.equal(list.skills.length, NAMES.length);
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
    const bytes = c.text !== undefined ? Buffer.from(c.text, 'utf8') : Buffer.from(c.blob, 'base64');
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
  const req = new Request('https://x.test/mcp', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', 'mcp-protocol-version': V, 'mcp-method': 'skills/list' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientCapabilities': {} } } }) });
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
  assert.equal(lr.skills.length, NAMES.length);
  assert.equal(lr.resultType, undefined);
  assert.equal(lr.ttlMs, undefined);
});

test('the built module is one file that exports a fetch handler, with the catalog inside', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-build-'));
  const file = join(dir, 'worker.mjs');
  writeFileSync(file, renderWorker(catalog));
  // A separate node process loads the file as a Cloudflare Worker module would: only the file, nothing from this repo.
  const script = `import w from ${JSON.stringify(pathToFileURL(file).href)};
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '${V}', 'io.modelcontextprotocol/clientCapabilities': {} } } });
    const res = await w.fetch(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': '${V}', 'mcp-method': 'skills/list' }, body }), {});
    console.log((await res.json()).result.skills.length);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), String(NAMES.length));
});

test('a method name from Object.prototype is not found, and the response is never a 500', async () => {
  for (const method of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const res = await call(method, { a: 1 });
    assert.equal(res.status, 404, method);
    assert.equal((await res.json()).error.code, -32601, method);
    const old = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { a: 1 } }) }));
    assert.equal(old.status, 200, method);
    assert.equal((await old.json()).error.code, -32601, method);
  }
});

test('a Mcp-Name that is not valid base64 or UTF-8 is a header mismatch, not a 500', async () => {
  for (const bad of ['=?base64?!!!?=', `=?base64?${Buffer.from([0xff, 0xfe]).toString('base64')}?=`]) {
    const res = await call('resources/read', { uri: 'skill://equip/SKILL.md' }, { headers: { 'mcp-name': bad } });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, -32020);
  }
});

test('an id must be a string or a number, and a request with no version anywhere is the legacy form', async () => {
  for (const id of [null, {}, [1], true]) {
    const res = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }) }));
    assert.equal(res.status, 400, JSON.stringify(id));
    assert.equal((await res.json()).error.code, -32600);
  }
  const zero = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }) }));
  assert.deepEqual((await zero.json()).result, {});
});

test('ALLOWED_ORIGINS from the environment is honored', async () => {
  const req = (origin) => new Request('https://x.test/mcp', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'mcp-protocol-version': V, 'mcp-method': 'skills/list' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientCapabilities': {} } } }) });
  assert.equal((await handle(req('https://app.example'))).status, 403);
  assert.equal((await handle(req('https://app.example'), { ALLOWED_ORIGINS: 'https://other.example, https://app.example' })).status, 200);
});

test('a request missing a required _meta field is 400 -32602, and an error with no usable id has no id', async () => {
  const send = (params, headers = {}) => handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': V, 'mcp-method': 'skills/list', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params }) }));
  for (const params of [{}, { _meta: { 'io.modelcontextprotocol/protocolVersion': V } }, { _meta: { 'io.modelcontextprotocol/clientCapabilities': {} } }, { _meta: { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientCapabilities': [] } }]) {
    const res = await send(params);
    assert.equal(res.status, 400, JSON.stringify(params));
    assert.equal((await res.json()).error.code, -32602);
  }
  const bad = await (await send({}, { origin: 'https://evil.example' })).json();
  assert.equal('id' in bad, false);
});

test('ping is answered on the older-revision path only (it is removed in 2026-07-28)', async () => {
  assert.equal((await call('ping')).status, 404);
  const old = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }));
  assert.deepEqual((await old.json()).result, {});
});

test('every result names the server, and resources/list names a SKILL.md by its frontmatter', async () => {
  for (const m of ['server/discover', 'skills/list', 'resources/list']) assert.equal((await ok(await call(m)))._meta['io.modelcontextprotocol/serverInfo'].name, 'claudius-skills', m);
  const list = await ok(await call('resources/list'));
  const equip = list.resources.find((r) => r.uri === 'skill://equip/SKILL.md');
  assert.equal(equip.name, 'equip');
  assert.match(equip.description, /^Keeps every plugin/);
});

test('catalog: an unquoted value a YAML parser would read differently fails the build', () => {
  for (const v of ['has a # comment', 'a: b', 'trailing ', 'True', '~', 'yes', '1e3', '1.10', '*star', '- item', '2026-11-26T10:00:00Z', '2026-11-26 10:00:00', '1:30', '12345678901234567890', '+5', '0x1f']) {
    assert.throws(() => parseFrontmatter(`---\nname: a\ndescription: d\nx: ${v}\n---\n`, 'x'), /plain YAML scalar|flat/, JSON.stringify(v));
  }
  assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: d\nx: 10\ny: 1.5\nz: "True"\n---\n', 'x'), { name: 'a', description: 'd', x: 10, y: 1.5, z: 'True' });
});

test('a uri that is not a string is -32602 on both paths, never a 500', async () => {
  for (const uri of [{ toString: 1 }, 5, null, ['a']]) {
    for (const method of ['skills/get', 'resources/read']) {
      const legacy = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { uri } }) }));
      assert.equal(legacy.status, 200, `${method} ${JSON.stringify(uri)}`);
      assert.equal((await legacy.json()).error.code, -32602);
    }
    const modern = await (await call('skills/get', { uri })).json();
    assert.equal(modern.error.code, -32602);
  }
});

test('a request without jsonrpc 2.0 or with an id that is not finite is -32600', async () => {
  const post = (body) => handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
  for (const body of ['{"id":1,"method":"ping"}', '{"jsonrpc":"1.0","id":1,"method":"ping"}', '{"jsonrpc":"2.0","id":1e400,"method":"ping"}']) {
    const res = await post(body);
    assert.equal(res.status, 400, body);
    assert.equal((await res.json()).error.code, -32600);
  }
  const keep = await (await post('{"id":5}')).json();
  assert.equal(keep.id, 5);
});

test('catalog: duplicate keys, odd single quotes and YAML floats fail, and a folder or name that is unsafe fails', () => {
  const fm = (line) => `---\nname: a\ndescription: d\n${line}\n---\n`;
  assert.throws(() => parseFrontmatter(`---\nname: a\nname: b\ndescription: d\n---\n`, 'x'), /appears twice/);
  for (const v of ["'a' # c'", "'it's'", '.inf', '.NaN']) assert.throws(() => parseFrontmatter(fm(`x: ${v}`), 'x'), /plain YAML scalar/, v);
  assert.equal(parseFrontmatter(fm("x: 'it''s'"), 'x').x, "it's");
  assert.throws(() => parseFrontmatter(fm('x:y'), 'x'), /flat/);
  const long = 'a'.repeat(65);
  assert.throws(() => buildCatalog(fixture({ [`${long}/SKILL.md`]: `---\nname: ${long}\ndescription: d\n---\n` })), /not a valid skill name/);
  const dir = fixture({ 'real/SKILL.md': '---\nname: a\ndescription: d\n---\n' });
  const holder = mkdtempSync(join(tmpdir(), 'skills-'));
  symlinkSync(join(dir, 'real'), join(holder, 'a'));
  assert.throws(() => buildCatalog(holder), /symbolic link/);
});

test('an id that is not an integer is -32600, and resources/read with no uri is -32602', async () => {
  const bad = await handle(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1.5,"method":"skills/list"}' }));
  assert.equal(bad.status, 400);
  const res = await call('resources/read', {}, { headers: { 'mcp-name': '' } });
  assert.equal((await res.json()).error.code, -32602);
});

test('catalog: a SKILL.md that starts with a BOM builds, and its text keeps the bytes', () => {
  const md = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('---\nname: a\ndescription: d\n---\nbody\n')]);
  const f = buildCatalog(fixture({ 'a/SKILL.md': md })).skills[0].files[0];
  assert.equal(f.size, md.length);
  assert.equal(Buffer.from(f.text, 'utf8').equals(md), true);
});
