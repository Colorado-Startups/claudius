// Two Code Project lines read from the project memory folder on this machine (needs: local-files, tests/privacy.mjs).
// The folder comes from a param (memory_dir, under home or absolute): this collector names no path of its own.
//   cp_memory.start_tokens  the index file's bytes / 4, at most its first 200 lines or 25 KB, the part Claude Code loads at
//                           the start of a session; the notes the index points to load later and are not counted
//                           (Claude Code Docs: How Claude remembers your project, code.claude.com/docs/en/memory, read 2026-11-26)
//   cp_memory.stale_notes   the notes (the folder's .md files but the index) whose date is older than params.stale_days:
//                           the `modified:` line of the front matter, which Claude Code writes as an ISO 8601 time (same page),
//                           else the file's own time. Only the date line is read, never a note's text.
// A folder or index that is not there is not measured, never 0 (Git Crafter quality/SCORING.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, resolvePath, useLib } from '../lib/engine.mjs';

export const area = 'cp-memory';
export const metricIds = ['cp_memory.start_tokens', 'cp_memory.stale_notes'];

const TARGETS = ['code-project.json', 'code-project-tabs.json', 'code-project-features.json'].flatMap((f) => JSON.parse(fs.readFileSync(new URL(`../../targets/${f}`, import.meta.url), 'utf8')));
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const DEFINED = Object.fromEntries(TARGETS.map((t) => [t.id, t]));
const [START, STALE] = metricIds;
const DAY = 864e5;
const MAX_LINES = 200;
const MAX_BYTES = 25000;

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(gather(opts), opts.home);
}

function gather({ params = {}, allParams = {}, root = '.', now = Date.now(), home = os.homedir() } = {}) {
  const p = { ...TEMPLATE, ...allParams['code-project.json'], ...allParams['code-project-tabs.json'], ...allParams['code-project-features.json'], ...params };
  const cnc = (why) => ({ [START]: { could_not_check: why, source: DEFINED[START].source }, [STALE]: { could_not_check: why, source: DEFINED[STALE].source } });
  if (!p.memory_dir) return cnc('no memory_dir param: set it to the folder that holds the memory index');
  const dir = resolvePath(p.memory_dir, { home, root });
  const stamp = new Date(now).toISOString();
  const out = {};
  try {
    const index = resolvePath(p.memory_index, { home, root: dir });
    if (fs.lstatSync(index).isSymbolicLink()) throw new Error('symlink');
    const text = fs.readFileSync(index, 'utf8');
    const loaded = text.split('\n').slice(0, MAX_LINES).join('\n');
    const bytes = Math.min(Buffer.byteLength(loaded), MAX_BYTES);
    const value = Math.ceil(bytes / 4);
    out[START] = { value, detail: [{ label: p.memory_index, value, unit: 'tokens' }], source: `${DEFINED[START].source}; ${p.memory_index} bytes / 4, first ${MAX_LINES} lines or 25 KB`, read_at: stamp };
  } catch {
    out[START] = { could_not_check: `no ${p.memory_index} in the memory folder on this machine`, source: DEFINED[START].source };
  }
  out[STALE] = staleNotes(dir, p, now);
  return out;
}

// The notes older than stale_days. A note with no date line takes its file time; an unreadable note is skipped.
function staleNotes(dir, p, now) {
  const source = `${DEFINED[STALE].source}; the notes' own date lines or file times, ${p.stale_days} days`;
  let notes;
  try {
    notes = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.isSymbolicLink() && e.name.endsWith('.md') && e.name !== p.memory_index).map((e) => e.name);
  } catch {
    return { could_not_check: 'could not list the memory folder on this machine', source };
  }
  if (!notes.length) return { could_not_check: 'the memory folder holds no note besides the index', source };
  let stale = 0;
  let read = 0;
  for (const n of notes) {
    const file = path.join(dir, n);
    let at = NaN;
    try {
      const fd = fs.openSync(file, 'r');
      let head;
      try {
        const buf = Buffer.alloc(4096);
        head = buf.subarray(0, fs.readSync(fd, buf, 0, 4096, 0)).toString('utf8').split('\n').slice(0, 12).join('\n');
      } finally {
        fs.closeSync(fd);
      }
      at = Date.parse(/^\s*modified:\s*(\S+)/m.exec(head)?.[1] ?? '');
      if (!Number.isFinite(at)) at = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    read += 1;
    if (now - at > p.stale_days * DAY) stale += 1;
  }
  if (!read) return { could_not_check: 'no note in the memory folder could be read', source };
  return { value: stale, detail: [{ label: `of ${read} notes`, value: stale, unit: 'notes' }], source, read_at: new Date(now).toISOString() };
}
