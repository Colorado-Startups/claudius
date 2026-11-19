// Listings for the desktop app collector (desktop-app.mjs): what a session
// loads before any work, read from the attachment records Claude Code writes
// into a transcript.
// The attachment types are observed in transcripts, not named in Anthropic's
// public docs. Names and sizes are read; a server's error text never is.

const list = (v) => (Array.isArray(v) ? v : []);
const size = (lines) => lines.reduce((n, l) => n + Buffer.byteLength(String(l)), 0);
// A server entry is its name, or a record that holds one beside an error.
const names = (v) => list(v).map((s) => (typeof s === 'string' ? s : String(s?.name ?? ''))).filter(Boolean);
const without = (all, gone) => (gone.length ? all.filter((n) => !gone.includes(n)) : all);

// An empty listing: names by kind, bytes by kind, and the server state at
// the session's first and last tool listing.
export function emptyListing() {
  return { skills: [], agents: [], instructed: [], tools: [], bytes: { tools: 0, skills: 0, agents: 0, instructions: 0 }, first: null, last: null };
}

// One attachment type each. A delta's bytes stay counted after a removal:
// what was sent stays in the session's context.
const FOLD = {
  skill_listing(out, a) {
    out.skills.push(...list(a.names));
    out.bytes.skills += Buffer.byteLength(String(a.content ?? ''));
  },
  agent_listing_delta(out, a) {
    out.agents = without([...out.agents, ...list(a.addedTypes)], list(a.removedTypes));
    out.bytes.agents += size(list(a.addedLines));
  },
  mcp_instructions_delta(out, a) {
    out.instructed = without([...out.instructed, ...list(a.addedNames)], list(a.removedNames));
    out.bytes.instructions += size(list(a.addedBlocks));
  },
  deferred_tools_delta(out, a) {
    out.tools = without([...out.tools, ...list(a.addedNames)], list(a.removedNames));
    out.bytes.tools += size(list(a.addedLines));
    const state = { pending: names(a.pendingMcpServers), needsAuth: names(a.needsAuthMcpServers), failed: names(a.failedMcpServers) };
    out.first ??= state;
    out.last = state;
  },
};

// Folds one transcript record into a listing; any other record is left alone.
export function foldListing(out, record) {
  if (record.type !== 'attachment') return;
  FOLD[record.attachment?.type]?.(out, record.attachment);
}

// True when the transcript held at least one tool listing.
export const hasListing = (listing) => Boolean(listing.last);

// True for a server the app adds itself: an entry ending in _ is a prefix,
// any other a whole name.
export function isAppServer(server, appServers) {
  return list(appServers).some((entry) => (String(entry).endsWith('_') ? server.startsWith(entry) : server === entry));
}
