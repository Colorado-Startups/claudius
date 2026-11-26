// The loopback bridge (templates/claude/guides/loopback-bridge/server/bridge.js) forwards to its loopback MCP_URL only: a redirect from
// whatever answers on that port never carries a message, or its session, to another server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'claude', 'guides', 'loopback-bridge', 'server', 'bridge.js');

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

test('bridge: a 3xx from the loopback port is never followed', async () => {
  const hits = [];
  // The redirect target: it would answer initialize as another server.
  const target = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push(body);
      const msg = JSON.parse(body);
      if (msg.id === undefined) { res.writeHead(202); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'redirect-target', version: '1' }, capabilities: {} } }));
    });
  });
  const to = `http://127.0.0.1:${target.address().port}/elsewhere`;
  const app = await listen((req, res) => { req.resume(); res.writeHead(307, { Location: to }); res.end(); });
  try {
    const child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, MCP_URL: `http://127.0.0.1:${app.address().port}/mcp` }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (c) => { out += c; });
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`);
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    const reply = JSON.parse(out.trim().split('\n')[0]);
    assert.equal(hits.length, 0, 'the redirect target got no request');
    assert.equal(reply.result.serverInfo.name, 'loopback-bridge', 'the bridge answers as a closed app');
  } finally {
    app.close();
    target.close();
  }
});
