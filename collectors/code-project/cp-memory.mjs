// cp_memory.start_tokens, read from the project memory index a thread loads at start. The memory folder is a
// param (memory_dir, under home or absolute): this collector names no path of its own. The tokens are the index
// file's bytes / 4, the estimate the other collectors use. A folder or index that is not there is not measured, never 0
// (Git Crafter quality/SCORING.md); the notes the index points to load later and are not counted.
// cp_memory.stale_notes counts the notes (the folder's .md files but the index) whose date is older than params.stale_days:
// the `modified:` line of its front matter, else the file's own time. Only the date line is read, never a note's text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, useLib } from '../lib/engine.mjs';

export const area = 'cp-memory';
// Reads a folder on this machine, not the GitHub API.
export const metricIds = ['cp_memory.start_tokens', 'cp_memory.stale_notes'];

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/code-project.json', import.meta.url), 'utf8'));
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const DEFINED = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../../targets/code-project-tabs.json', import.meta.url), 'utf8')).map((t) => [t.id, t]));
const ID = metricIds[0];
const STALE = metricIds[1];
const DAY = 864e5;

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(gather(opts), opts.home);
}

const under = (dir, home) => (dir.startsWith('~/') ? path.join(home, dir.slice(2)) : dir);

function gather({ params = TEMPLATE, now = Date.now(), home = os.homedir() } = {}) {
  const p = { ...TEMPLATE, ...params };
  const source = DEFINED[ID]?.source ?? 'the project memory index';
  const cnc = (why) => ({ [ID]: { could_not_check: why, source }, [STALE]: { could_not_check: why, source: DEFINED[STALE]?.source ?? source } });
  if (!p.memory_dir) return cnc('no memory_dir param: set it to the folder that holds the memory index');
  const file = path.join(under(p.memory_dir, home), p.memory_index);
  let bytes;
  try {
    bytes = fs.statSync(file).size;
  } catch {
    return cnc(`no ${p.memory_index} in memory_dir`);
  }
  const value = Math.ceil(bytes / 4);
  return {
    [STALE]: staleNotes(under(p.memory_dir, home), p, now),
    [ID]: {
      value,
      detail: [{ label: p.memory_index, value, unit: 'tokens' }],
      source: `${source}; the index file's bytes / 4, the notes it points to not counted`,
      read_at: new Date(now).toISOString(),
    },
  };
}

// The notes older than stale_days. A note with no date line takes its file time; an unreadable note is skipped.
function staleNotes(dir, p, now) {
  const source = `${DEFINED[STALE]?.source ?? 'the project memory files'}; the notes' own date lines or file times, ${p.stale_days} days`;
  let notes = [];
  try {
    notes = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== p.memory_index);
  } catch {
    return { could_not_check: 'could not list the memory folder', source };
  }
  if (!notes.length) return { could_not_check: 'the memory folder holds no note besides the index', source };
  let stale = 0;
  for (const n of notes) {
    const file = path.join(dir, n);
    let at = NaN;
    try {
      const head = fs.readFileSync(file, 'utf8').split('\n').slice(0, 12).join('\n');
      at = Date.parse(/^\s*modified:\s*(\S+)/m.exec(head)?.[1] ?? '');
      if (!Number.isFinite(at)) at = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (now - at > p.stale_days * DAY) stale += 1;
  }
  return { value: stale, detail: [{ label: `of ${notes.length} notes`, value: stale, unit: 'notes' }], source, read_at: new Date(now).toISOString() };
}
