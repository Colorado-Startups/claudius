// Shared by both guard hooks. A hook here can only refuse: it prints one deny decision, or nothing.
// It never grants a permission, edits a file, or opens a network connection (tests/guard-hooks.test.mjs checks the source).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// True when this file was started as the hook script. import.meta.main exists on Node 24.2 and later. Before that,
// the file's real path is compared with the real path of argv[1], so a path with a space or a symlink still runs.
export function runsDirectly(meta) {
  if (typeof meta.main === 'boolean') return meta.main;
  try {
    return Boolean(process.argv[1]) && fileURLToPath(meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export function deny(reason) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`);
  process.exit(0);
}

export async function readInput() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try { return JSON.parse(text); } catch { return null; }
}
