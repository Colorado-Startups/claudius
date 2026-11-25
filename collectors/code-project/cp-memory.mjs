// cp_memory.start_tokens, read from the project memory index a thread loads at start. The memory folder is a
// param (memory_dir, under home or absolute): this collector names no path of its own. The tokens are the index
// file's bytes / 4, the estimate the other collectors use. A folder or index that is not there is not measured, never 0
// (Git Crafter quality/SCORING.md); the notes the index points to load later and are not counted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, useLib } from '../lib/engine.mjs';

export const area = 'cp-memory';
// Reads a folder on this machine, not the GitHub API.
export const metricIds = ['cp_memory.start_tokens'];

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/code-project.json', import.meta.url), 'utf8'));
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const DEFINED = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../../targets/code-project-tabs.json', import.meta.url), 'utf8')).map((t) => [t.id, t]));
const ID = metricIds[0];

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(gather(opts), opts.home);
}

const under = (dir, home) => (dir.startsWith('~/') ? path.join(home, dir.slice(2)) : dir);

function gather({ params = TEMPLATE, now = Date.now(), home = os.homedir() } = {}) {
  const p = { ...TEMPLATE, ...params };
  const source = DEFINED[ID]?.source ?? 'the project memory index';
  const cnc = (why) => ({ [ID]: { could_not_check: why, source } });
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
    [ID]: {
      value,
      detail: [{ label: p.memory_index, value, unit: 'tokens' }],
      source: `${source}; the index file's bytes / 4, the notes it points to not counted`,
      read_at: new Date(now).toISOString(),
    },
  };
}
