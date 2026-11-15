// What each block came to, and the notes and sessions the metrics read (blockers.mjs).

import { LAST_SESSIONS, RETRY_MS } from './blockers-core.mjs';
import { sameCall, similar } from './blockers-shell.mjs';
import { DISCARDED, neutralStep, writesFile } from './blockers-neutral.mjs';

// What a block came to, from the calls after it in its transcript within
// RETRY_MS. Ambiguities read as false alarm and known workaround families are
// vetoed; a workaround sharing no words with the blocked command and hitting
// no veto can still read held. Held: 'none' (no
// similar call succeeded), or every similar call that succeeded ran only the
// blocked command's own steps, as typed, steps that match the rule's fix
// signals and write no file, and neutral steps (neutralStep()): 'fixed' when
// one of those is a fix, 'dropped' when none is. False alarm: 'same'
// (essentially the same call ran unblocked) or 'unfixed' (a similar success
// ran a step of its own, or any success in the window matched a veto).
// 'unread': the blocked call cannot be read.
export function outcomeOf(call, later, { fixes = new Map() } = {}) {
  if (call.family === 'Bash' ? !call.segments.length : call.inputKey === null) return 'unread';
  const runs = later.filter((c) => !c.block && c.family === call.family && c.at - call.at <= RETRY_MS);
  if (runs.some((c) => sameCall(call, c) === true)) return 'same';
  const isSimilar = (c) => similarCall(call, c);
  const signals = (call.block?.rules ?? [call.block?.label]).flatMap((r) => fixes.get(r) ?? []);
  const hits = (c, re) => re.test(c.command ?? '') || (c.steps ?? []).some((step) => re.test(step) || re.test(signalForm(step)));
  // However few words it shares, a command that runs a known workaround anywhere in
  // the window is a retry, and so is the first command after the block when it runs
  // a fix. A later fix-like command (a git push, an ls) is other work, not a retry.
  const first = runs.find((c) => !c.error);
  const ran = runs.filter((c) => !c.error && (isSimilar(c) || signals.some((x) => x.veto && hits(c, x.re)) || (c === first && signals.some((x) => hits(c, x.re)))));
  if (ran.some((c) => signals.some((x) => x.veto && hits(c, x.re)))) return 'unfixed';
  return heldAs(call, ran, signals) ?? 'unfixed';
}
// Another call of the same family that does the same kind of thing.
function similarCall(call, c) {
  if (call.family === 'Bash') return similar(call.words, c.words);
  return call.family === 'edit' ? call.target === c.target : true;
}
const FALSE_ALARM = new Set(['same', 'unfixed']);

// A step as a fix signal reads it (#215): a discarded redirection, a leading
// timeout and git's -C dir change where or how long it runs, not what it does,
// so `timeout 60 node --test a.test.mjs 2>&1` and `git -C "$W" merge
// --ff-only` match their signals. Matching and own-step checks use this form.
export function signalForm(step) {
  return String(step)
    .replace(DISCARDED, ' ')
    .replace(/^timeout( -[a-zA-Z]+( [^\s-]\S*)?)* \d+[smhd]? /, '')
    .replace(/^git( -C ('[^']*'|"[^"]*"|[^\s'"])\S*)+(?= )/, 'git')
    .replace(/\s+/g, ' ')
    .trim();
}

// How a block held, or null when it did not: every similar success may run
// only the blocked command's own steps, unchanged, fix steps that write no
// file and neutral steps. A drop or a route-around with no fix in the same
// call still fails.
// Another tool's similar success has no steps to check, so it never holds.
function heldAs(call, ran, signals) {
  if (!ran.length) return 'none';
  if (call.family !== 'Bash') return null;
  const kindOf = stepKinds(call, signals);
  const each = ran.map((c) => new Set(c.steps.map(kindOf)));
  if (each.some((kinds) => kinds.has(null))) return null;
  return each.some((kinds) => kinds.has('fix')) ? 'fixed' : 'dropped';
}

// What a retry's step is to the blocked call: 'own' (one of its steps, as
// typed), 'fix', 'neutral', or null, a step of its own.
function stepKinds(call, signals) {
  const own = new Set(call.steps.map(signalForm));
  return (step) => {
    if (own.has(signalForm(step))) return 'own';
    if (isFix(step, signals)) return 'fix';
    return neutralStep(step) ? 'neutral' : null;
  };
}

// A step that applies the fix: it matches a fix signal and writes no file.
const isFix = (step, signals) => !writesFile(step) && signals.some((x) => !x.veto && x.re.test(signalForm(step)));

// Every block up to now with its outcome, time and tokens.
export function blocksOf(files, upTo, opts = {}) {
  const out = [];
  for (const f of files) {
    f.calls.forEach((call, i) => {
      if (!call.block || !(call.at <= upTo)) return;
      const outcome = outcomeOf(call, f.calls.slice(i + 1), opts);
      const next = f.calls[i + 1];
      const gap = next ? next.at - call.at : NaN;
      const answer = f.messages.find((m) => m.idx > call.resultIdx);
      const name = call.block.kind === 'guard' ? `guard: ${call.block.rules.join(', ')}` : call.block.label;
      out.push({ ...call.block, at: call.at, resultAt: call.resultAt, name, outcome, falseAlarm: FALSE_ALARM.has(outcome), ms: Number.isFinite(gap) ? Math.min(Math.max(gap, 0), RETRY_MS) : null, tokens: answer ? answer.tokens : null, billable: answer ? answer.billable : null, answer: answer ? answer.id : null });
    });
  }
  // Blocks refused together (parallel tool calls) are answered by one call;
  // they share its tokens, so the call counts once.
  const shared = new Map();
  for (const b of out) if (b.answer) shared.set(b.answer, (shared.get(b.answer) ?? 0) + 1);
  for (const b of out) if (b.answer) {
    b.tokens /= shared.get(b.answer);
    b.billable /= shared.get(b.answer);
  }
  return out;
}

// Model calls in a transcript after line `from`, up to its next compaction:
// the calls that read again whatever entered at `from`.
function readsAfter(f, from) {
  const end = Math.min(...f.compactions.filter((c) => c > from), Infinity);
  return f.messages.filter((m) => m.idx > from && m.idx < end).length;
}

// Hook text in the span, and the WARN and INFRA lines of git commit and
// push, as estimated tokens times the calls that read them.
export function notesOf(files, inSpan) {
  const out = [];
  for (const f of files) {
    for (const h of f.hooks) {
      if (inSpan(h.at)) out.push({ label: h.label, ms: h.ms, tokens: Math.ceil(h.chars / 4) * readsAfter(f, h.idx) });
    }
    for (const c of f.calls) {
      if (c.noteChars && inSpan(c.at)) out.push({ label: c.git === 'push' ? 'pre-push' : 'pre-commit', ms: null, tokens: Math.ceil(c.noteChars / 4) * readsAfter(f, c.resultIdx) });
    }
  }
  return out;
}

// The transcripts of the last LAST_SESSIONS main sessions that began by
// `upTo`, newest first: each a list of its files, the main one and its subagents.
export const sessionStart = (list) => Math.min(...list.filter((f) => f.main).map((f) => f.start));
// The newest LAST_SESSIONS sessions that started by upTo, each as its list of transcript files.
export function lastSessions(files, upTo) {
  const by = new Map();
  for (const f of files) if (f.sessionId) by.set(f.sessionId, [...(by.get(f.sessionId) ?? []), f]);
  return [...by.values()]
    .filter((list) => list.some((f) => f.main) && sessionStart(list) <= upTo)
    .sort((a, b) => sessionStart(b) - sessionStart(a))
    .slice(0, LAST_SESSIONS);
}
