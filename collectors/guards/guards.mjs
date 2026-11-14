// Blockers' Speed metric guards.call_ms: how long the bash guard takes to judge one harmless command, on the
// machine that runs the sessions. Moved from Git Crafter config/quality/collectors/guard-speed.mjs (v7
// quality/ledger/tab-remap.json, #26); its runner reading, guards.runner_call_ms, stays in Git Crafter.
//
// The guard reads the hook call on stdin and only parses it: the command is never run (Git Crafter
// rules/gates.md). Nothing here throws; a guard that cannot be timed is could_not_check with the reason, never 0.
// Timed only in a --local collect: a CI runner is not the session's machine, and it would time itself.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, useLib } from '../lib/engine.mjs';

export const area = 'guards';

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/guards.json', import.meta.url), 'utf8'));
export const metricIds = TARGETS.map((t) => t.id);
const ID = 'guards.call_ms';
const CI_REASON = 'the guard runs on the machine that runs the sessions; timed by a --local collect there';
// One harmless hook call, as Claude Code sends it before a Bash call.
const CALL = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });

// One timed run of the guard: { ms } or { error }. run is spawnSync's shape, so a test can stand in for it.
export function timeOnce(guard, run = spawnSync) {
  const start = process.hrtime.bigint();
  const r = run('python3', ['-I', guard], { input: CALL, timeout: 10_000, encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (r.error) return { error: r.error.code === 'ENOENT' ? 'python3 is not on PATH' : `the guard did not run: ${r.error.code ?? 'error'}` };
  if (r.status !== 0) return { error: `the guard exited ${r.status} on a harmless command` };
  return { ms };
}

// The median of params.runs runs; the median leaves out a cold first start.
export async function collect({ mode, params = {}, home = os.homedir(), lib, run } = {}) {
  useLib(lib);
  const guard = String(params.guard || '~/.claude/code-os/bash_guard.py');
  const at = guard.startsWith('~/') ? path.join(home, guard.slice(2)) : guard;
  const runs = Number(params.runs) > 0 ? Number(params.runs) : 10;
  const source = `latest: median wall time of ${runs} runs of python3 -I ${guard} judging one harmless command, on the machine that runs the sessions`;
  if (mode !== 'local') return { [ID]: { could_not_check: CI_REASON, source } };
  if (!fs.existsSync(at)) return { [ID]: { could_not_check: `no guard at ${guard}; set params.guard in targets/guards.json`, source } };
  const times = [];
  for (let i = 0; i < runs; i++) {
    const r = timeOnce(at, run);
    if (r.error) return { [ID]: { could_not_check: r.error, source } };
    times.push(r.ms);
  }
  times.sort((a, b) => a - b);
  const median = (times[Math.floor((runs - 1) / 2)] + times[Math.ceil((runs - 1) / 2)]) / 2;
  const row = (label, ms) => ({ label, value: Math.round(ms), unit: 'ms' });
  return redact({ [ID]: { value: Math.round(median), source, detail: [row('fastest run', times[0]), row('median', median), row('slowest run', times.at(-1))] } }, home);
}
