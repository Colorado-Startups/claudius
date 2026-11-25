// Guard hook (b): a tool named in the deny list of the repo the session runs in is refused.
// The list is `.claude/claudius-deny.json` in that repo: { "tools": ["mcp__Server__tool", "mcp__Server__prefix_*"], "reason": "why" }.
// A session in a repo with no list keeps every tool. A tool that is not listed is never touched.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deny, readInput, runsDirectly } from './deny.mjs';

const MAX_LIST_BYTES = 64 * 1024;

const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

// A plugin or connector can prefix a server's name (mcp__plugin_x_Mail__send_message), so a listed
// mcp__Mail__send_message also matches when the real server segment ends in _Mail.
export function names(toolName) {
  const [head, server, ...rest] = toolName.split('__');
  if (head !== 'mcp' || !server || rest.length === 0) return [toolName];
  const tool = rest.join('__');
  const tails = server.split('_').map((_, i, parts) => parts.slice(i).join('_'));
  return [toolName, ...tails.map((t) => `mcp__${t}__${tool}`)];
}

export function listedTool(toolName, patterns) {
  return patterns.some((p) => typeof p === 'string' && p.length > 0 && names(toolName).some((n) => globToRegExp(p).test(n)));
}

export function readList(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, '.claude', 'claudius-deny.json'), 'utf8');
    if (raw.length > MAX_LIST_BYTES) return null;
    const data = JSON.parse(raw);
    return Array.isArray(data?.tools) ? { tools: data.tools, reason: typeof data.reason === 'string' ? data.reason : '' } : null;
  } catch {
    return null;
  }
}

if (runsDirectly(import.meta)) {
  const input = await readInput();
  const toolName = typeof input?.tool_name === 'string' ? input.tool_name : '';
  const dir = process.env.CLAUDE_PROJECT_DIR || input?.cwd;
  if (toolName && dir) {
    const list = readList(dir);
    if (list && listedTool(toolName, list.tools)) {
      deny(`Claudius guard: ${toolName} is on this repo's deny list (.claude/claudius-deny.json).${list.reason ? ` ${list.reason}` : ''}`);
    }
  }
}
