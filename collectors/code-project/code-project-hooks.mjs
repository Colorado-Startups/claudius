// cp_hooks.unsafe_hooks, read from the hook entries a repo commits: the "hooks" of the settings files and of the
// plugin hook files named by params.hook_files. Each hook entry of type command is matched against
// params.unsafe_hooks, labelled regular expressions (a force push, --no-verify, a download piped to a shell, a
// recursive delete). The value counts the hook commands that match at least one, and the detail names each by its
// file and event, never its command. A repo with no hook entry reads not measured, never 0 (Git Crafter
// quality/SCORING.md); so does a hook file that is not valid JSON, since it cannot be read.
import fs from 'node:fs';
import path from 'node:path';
import { redact, useLib } from '../lib/engine.mjs';

export const area = 'cp-hooks';
export const metricIds = ['cp_hooks.unsafe_hooks'];

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/code-project.json', import.meta.url), 'utf8'));
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const DEFINED = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('../../targets/code-project-features.json', import.meta.url), 'utf8')).map((t) => [t.id, t]));
const ID = metricIds[0];

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(gather(opts), opts.home);
}

// Every command of a hooks object ({ Event: [{ matcher, hooks: [{ type, command }] }] }), with its event.
export function hookCommands(hooks) {
  if (!hooks || typeof hooks !== 'object') return [];
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : []))
    .filter((h) => h && typeof h.command === 'string' && (h.type ?? 'command') === 'command')
    .map((h) => ({ event, command: h.command })));
}

function gather({ root = '.', params = {}, allParams = {}, now = Date.now() } = {}) {
  const p = { ...TEMPLATE, ...allParams['code-project.json'], ...params };
  const source = DEFINED[ID]?.source ?? 'the hook entries of the repo files';
  const cnc = (why) => ({ [ID]: { could_not_check: why, source } });
  const rules = (p.unsafe_hooks ?? []).map((r) => ({ label: r.label, re: new RegExp(r.pattern, 'i') }));
  const hits = [];
  let entries = 0;
  for (const file of p.hook_files ?? []) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return cnc(`${file} is not valid JSON, so its hook entries cannot be read`);
    }
    for (const { event, command } of hookCommands(json.hooks)) {
      entries += 1;
      const bad = rules.filter((r) => r.re.test(command)).map((r) => r.label);
      if (bad.length) hits.push({ label: `${file}: ${event} (${bad.join(', ')})`, value: 1, unit: 'hooks' });
    }
  }
  if (!entries) return cnc(`no hook entry in ${(p.hook_files ?? []).join(', ')}`);
  return {
    [ID]: {
      value: hits.length,
      ...(hits.length ? { detail: hits } : {}),
      source: `${source}; ${entries} hook commands read`,
      read_at: new Date(now).toISOString(),
    },
  };
}
