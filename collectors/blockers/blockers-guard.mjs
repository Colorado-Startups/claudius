// The Blockers metrics about refusals, latest blocks and git hooks (blockers.mjs).

import { percentile } from '../lib/engine.mjs';
import { LAST_GIT, iso, item, median, round } from './blockers-core.mjs';
import { ledgerRow } from './blockers-ledger.mjs';

// Hook labels of the retired bash and write guards. Old transcripts still show
// them, so the ledger and the latest-block metrics read them; the rate below does not.
const RETIRED = new Set(['bash guard, no rule named', 'write guard']);
// A refusal that still happens: a permission rule (deny rules, Auto mode, the
// built-in safety checks) or a hook (hookify, the app's hooks).
const isRefusal = (b) => b.kind === 'permission' || (b.kind === 'hook' && !RETIRED.has(b.label));

// Refusals per 100 tool calls, by what refused: deny rules, safety checks and hooks.
export function guardRateMetric(c) {
  const { blocks, haveFiles, calls, TRANSCRIPTS, RATE, per, filesReason, noCalls, val, cnc } = c;
  const id = 'blockers.guard_blocks_per_100_calls';
  const source = `${TRANSCRIPTS}: Claude Code permission refusals (Auto mode, deny rules and built-in safety checks) and hook blocks (hookify and app hooks), ${RATE}`;
  if (!haveFiles) return cnc(id, filesReason, source);
  if (!calls.length) return cnc(id, noCalls, source);
  const refusals = blocks.filter(isRefusal);
  const labels = [...new Set(refusals.map((b) => b.label))];
  val(id, round(per(refusals.length), 3), `${source}; ${refusals.length} refusals`, labels.map((l) => item(l, round(per(refusals.filter((b) => b.label === l).length), 3))).sort((x, y) => y.value - x.value));
}

// Ledger rows: one per guard rule in old transcripts, then one per other
// refusal (tool hooks and permission checks). Git gates join their hook's row in gitMetrics.
export function refusalRows(c) {
  const { guardBlocks, blocks, ledger } = c;
  for (const rule of [...new Set(guardBlocks.flatMap((b) => b.rules))].sort()) {
    const mine = guardBlocks.filter((b) => b.rules.includes(rule));
    ledger.push(ledgerRow(`guard: ${rule}`, 'Speed', { fires: mine.length, alarms: mine, ms: mine.map((b) => b.ms), tokens: mine.map((b) => b.tokens) }));
  }
  const others = blocks.filter((b) => b.kind === 'hook' || b.kind === 'permission');
  for (const label of [...new Set(others.map((b) => b.label))].sort()) {
    const mine = others.filter((b) => b.label === label);
    ledger.push(ledgerRow(label, 'Speed', { fires: mine.length, alarms: mine, ms: mine.map((b) => b.ms), tokens: mine.map((b) => b.tokens) }));
  }
}

// What the latest block cost, read now: the newest block that has `key`, and
// each blocker's own latest beside it. How often blocks fire is
// guard_blocks_per_100_calls.
function latestBlock(blocks, key, scale) {
  const have = blocks.filter((b) => Number.isFinite(b[key])).sort((x, y) => y.at - x.at);
  if (!have.length) return null;
  const rows = [...new Set(have.map((b) => b.name))].map((name) => item(name, scale(have.find((b) => b.name === name)[key])));
  return { block: have[0], value: scale(have[0][key]), detail: rows.sort((x, y) => y.value - x.value) };
}

const when = (b) => `${b.name}, ${new Date(b.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// Seconds and tokens the latest block cost, beside each blocker's latest.
export function latestBlockMetrics(c) {
  const { blocks, haveFiles, calls, SPAN, TRANSCRIPTS, noCalls, filesReason, val, cnc } = c;
  const blockSource = `${TRANSCRIPTS}: refusals by the retired bash and write guards (old transcripts), app hooks, permission checks and git hooks, over ${SPAN}`;
  const on = haveFiles && calls.length;
  const seconds = on ? latestBlock(blocks, 'ms', (ms) => round(ms / 1000, 1)) : null;
  const tokens = on ? latestBlock(blocks, 'tokens', Math.round) : null;
  const noBlock = on ? `no block among ${SPAN}` : haveFiles ? noCalls : filesReason;
  if (!seconds) cnc('blockers.latest_block_seconds', noBlock, blockSource);
  else val('blockers.latest_block_seconds', seconds.value, `${blockSource}; the latest block (${when(seconds.block)}) to the next call, at most 10 minutes; beside it, each blocker's latest`, seconds.detail);
  if (!tokens) return cnc('blockers.latest_block_tokens', noBlock, blockSource);
  const fresh = Math.round(tokens.block.billable ?? 0);
  val('blockers.latest_block_tokens', tokens.value, `${blockSource}; message.usage of the call that answered the latest block (${when(tokens.block)}), in full, one share when blocks refused together share it; ${fresh} of them new tokens (input, output, cache write), the rest the conversation that call read again; beside it, each blocker's latest`, tokens.detail);
}

// Git hooks: commit and push time over the last LAST_GIT of each; their
// gates' blocks and their notes over the span.
export function gitMetrics(c) {
  const { haveFiles, allCalls, calls, blocks, notes, ledger, TRANSCRIPTS, filesReason, val, cnc } = c;
  const gitSource = (verb) => `${TRANSCRIPTS}: the last ${LAST_GIT} Bash calls that run git ${verb} alone, tool call to tool result`;
  for (const [verb, hook, id] of [
    ['commit', 'pre-commit', 'blockers.git_commit_seconds'],
    ['push', 'pre-push', 'blockers.git_push_seconds'],
  ]) {
    const finished = allCalls.filter((x) => x.git === verb && Number.isFinite(x.resultAt - x.at));
    const timed = finished.slice(0, LAST_GIT).map((x) => (x.resultAt - x.at) / 1000);
    if (!haveFiles) cnc(id, filesReason, gitSource(verb));
    else if (timed.length) {
      val(id, round(median(timed)), `${gitSource(verb)}; ${timed.length} read, from ${iso(finished[timed.length - 1].at)} UTC`, [item(`${hook} runs timed`, timed.length, ''), item('p90', round(percentile(timed, 0.9)), 's'), item('slowest', round(Math.max(...timed)), 's')]);
    } else cnc(id, `no git ${verb} call in this repo's transcripts`, gitSource(verb));
    if (!haveFiles) continue;
    const gates = blocks.filter((b) => b.kind === 'git' && b.label === hook);
    const runs = calls.filter((x) => x.git === verb || x.git === 'both').length;
    const spanMs = calls.filter((x) => x.git === verb && Number.isFinite(x.resultAt - x.at)).map((x) => x.resultAt - x.at);
    ledger.push(ledgerRow(`git ${hook} hook`, 'Quality', { fires: runs, alarms: gates, ms: spanMs, tokens: [...notes.filter((n) => n.label === hook).map((n) => n.tokens), ...gates.map((b) => b.tokens)] }));
  }
}
