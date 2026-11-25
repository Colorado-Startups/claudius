// What the Claude Code Projects collector reads from this machine's session transcripts (code-projects.mjs).
// From a record it keeps the type, the timestamp, the origin kind, whether a tool result is in it, and a
// reply's message id and token counts. A prompt, a reply and a tool result are never read.

import fs from 'node:fs';
import { eachLine, mainSessions } from '../instructions/instructions-sessions.mjs';

const MIN = 6e4;
const DAY = 864e5;

const list = (v) => (Array.isArray(v) ? v : []);
const count = (n) => (Number.isFinite(n) ? n : 0);

// Whether a record is one a person typed: its origin kind is params.human_origin, or it has no origin and is
// no tool result, meta record or subagent line.
function typedByPerson(record, humanOrigin) {
  if (record.type !== 'user' || record.isMeta || record.isSidechain) return false;
  if (list(record.message?.content).some((p) => p?.type === 'tool_result')) return false;
  return record.origin?.kind ? record.origin.kind === humanOrigin : true;
}

// The main sessions of this repo's project folders, with the files of each (the main transcript and its
// subagents'), those last written before `since` left out.
function recentSessions(projectsDir, match, subagentsDir, now, since) {
  return mainSessions(projectsDir, match, subagentsDir, now).filter((s) => [s.file, ...s.subagents].some((f) => fs.statSync(f).mtimeMs >= since));
}

// The times a person resumed a session after more than idleMinutes idle, in the last `days` days, and the
// number of main sessions read. The gap is from the session's previous record.
export function idleRevivals(projectsDir, { match, subagentsDir, humanOrigin, idleMinutes, days = 7, now }) {
  const since = now - days * DAY;
  const sessions = mainSessions(projectsDir, match, subagentsDir, now);
  const revived = [];
  for (const s of sessions) {
    if (fs.statSync(s.file).mtimeMs < since) continue;
    let previous = null;
    eachLine(s.file, (record) => {
      const at = Date.parse(record.timestamp);
      if (!Number.isFinite(at)) return;
      if (previous !== null && at >= since && at - previous > idleMinutes * MIN && typedByPerson(record, humanOrigin)) revived.push(at);
      previous = at;
    });
  }
  return { revived, sessions: sessions.length };
}

// Billable tokens (input, output and cache write; cache reads left out) of every reply in the last `weeks`
// 7-day buckets, one count per message id, subagents included: index 0 the oldest, weeks - 1 the latest.
export function weeklyTokens(projectsDir, { match, subagentsDir, now, weeks }) {
  const since = now - weeks * 7 * DAY;
  const totals = Array(weeks).fill(0);
  const seen = new Set();
  for (const s of recentSessions(projectsDir, match, subagentsDir, now, since)) {
    for (const file of [s.file, ...s.subagents]) {
      eachLine(file, (record) => {
        const usage = record.type === 'assistant' ? record.message?.usage : null;
        const at = Date.parse(record.timestamp);
        const id = record.message?.id ?? record.requestId;
        if (!usage || !id || !(at >= since && at <= now) || seen.has(id)) return;
        seen.add(id);
        const age = Math.floor((now - at) / (7 * DAY));
        totals[weeks - 1 - Math.min(age, weeks - 1)] += count(usage.input_tokens) + count(usage.output_tokens) + count(usage.cache_creation_input_tokens);
      });
    }
  }
  return { totals, sessions: recentSessions(projectsDir, match, subagentsDir, now, since).length };
}
