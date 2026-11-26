#!/usr/bin/env node
// Stdio <-> Streamable HTTP bridge for an MCP server that listens only on this computer (loopback).
// Claude Desktop runs it as a desktop extension, so Cowork and the Code tab both get the server.
// No dependencies: Node 18+ fetch only. Never forwards to a host that is not loopback, and never follows a redirect.
//
// Settings come from the manifest's mcp_config.env:
//   MCP_URL       the app's MCP endpoint, such as http://127.0.0.1:<port>/mcp (required)
//   MCP_APP_NAME  the app's name, used in the closed-app message (optional)
//
// If the app behind MCP_URL is closed, the bridge still starts. It answers tools/list with no tools,
// polls every 5 s, and sends notifications/tools/list_changed once the app opens.
// It forwards requests and their replies only: it does not hold the server's own notification stream open.
"use strict";

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];
let URL_;
try { URL_ = new URL(process.env.MCP_URL || ""); } catch {
  process.stderr.write("set MCP_URL to the app's loopback MCP endpoint, such as http://127.0.0.1:<port>/mcp\n");
  process.exit(2);
}
if (!LOOPBACK.includes(URL_.hostname)) {
  process.stderr.write(`refusing non-loopback MCP_URL host ${URL_.hostname}\n`);
  process.exit(2);
}
const APP = process.env.MCP_APP_NAME || "The app";

let session = null;        // Mcp-Session-Id from the upstream server
let protocol = null;       // negotiated MCP-Protocol-Version
let clientInit = null;     // the client's initialize request, replayed after the app restarts
let ready = false;
let poll = null;

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const closedError = (id) => send({ jsonrpc: "2.0", id, error: { code: -32000,
  message: `${APP} is not running at ${URL_.origin}. Open it, then try again.` } });

async function post(msg) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (session) headers["Mcp-Session-Id"] = session;
  if (protocol) headers["MCP-Protocol-Version"] = protocol;
  // redirect: "error": a 3xx from the loopback port never sends the session or a message to another host.
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify(msg), redirect: "error" });
  if (res.headers.get("mcp-session-id")) session = res.headers.get("mcp-session-id");
  if (res.status === 202) return [];
  if (res.status === 404 && session) { const e = new Error("session expired"); e.expired = true; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  if (!(res.headers.get("content-type") || "").includes("text/event-stream")) return [].concat(JSON.parse(body));
  return body.split(/\r?\n\r?\n/).map((ev) => ev.split(/\r?\n/).filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart()).join("\n")).filter(Boolean).map((d) => JSON.parse(d));
}

// Opens an upstream session with the client's own initialize params. Returns the initialize result.
async function connect() {
  session = null; protocol = null;
  const [reply] = await post({ ...clientInit, id: "bridge-init" });
  if (!reply || reply.error) throw new Error("initialize failed");
  protocol = reply.result.protocolVersion;
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  ready = true;
  if (poll) { clearInterval(poll); poll = null; }
  return reply.result;
}

function startPolling() {
  ready = false;
  if (poll) return;
  poll = setInterval(async () => {
    try { await connect(); send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }); } catch {}
  }, 5000);
}

async function forward(msg, retried = false) {
  try {
    for (const reply of await post(msg)) send(reply);
  } catch (e) {
    if (e.expired && !retried) {                 // the app restarted: new session, same request
      try { await connect(); return forward(msg, true); } catch {}
    }
    startPolling();
    if (msg.id !== undefined && msg.method) closedError(msg.id);
  }
}

async function handle(msg) {
  if (msg.method === "initialize") {
    clientInit = msg;
    let result;
    try { result = await connect(); } catch {
      startPolling();
      result = { protocolVersion: msg.params.protocolVersion, serverInfo: { name: "loopback-bridge", version: "1.0.0" },
        capabilities: {}, instructions: `${APP} is closed. Its tools appear when it opens.` };
    }
    result.capabilities = { ...result.capabilities, tools: { ...(result.capabilities.tools || {}), listChanged: true } };
    return send({ jsonrpc: "2.0", id: msg.id, result });
  }
  if (!ready) {
    if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } });
    if (msg.id !== undefined && msg.method) {
      try { await connect(); } catch { return closedError(msg.id); }
    } else return;                               // drop notifications until the app is up
  }
  return forward(msg);
}

// One JSON-RPC message per line on stdin. Requests run in order, so replies keep their order.
let buffer = "", chain = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    chain = chain.then(() => handle(msg));
  }
});
process.stdin.on("end", () => chain.then(() => process.exit(0)));
