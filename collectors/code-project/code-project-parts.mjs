// Code Project tab, one group per project part: is each part set up in files a cloud thread reads?
//   Project and settings: setup_missing. Cloud environment and Mac: cloud_rules_missing.
//   Memory and instructions: memory_rules_missing. Scheduled tasks: tasks_missing.
//   PR auto-fix: autofix_rules_missing. Shipping and merging: ship_rules_missing.
//   Plugins, skills, connectors: plugins_untrusted.
// Reads repo files only, so a cloud thread and CI measure it as well as a Mac does. A part with no file to read is
// not measured, never 0 (Git Crafter quality/SCORING.md). The rules are regular expressions in params, so a repo
// that words a rule differently changes the pattern, not the code.
import fs from 'node:fs';
import path from 'node:path';

const read = (root, file) => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
};
const list = (root, dir) => {
  try {
    return fs.readdirSync(path.join(root, dir)).filter((f) => !f.startsWith('.'));
  } catch {
    return [];
  }
};
const lines = (items) => items.map((label) => ({ label, value: 1, unit: 'items' }));

// One setup check: a file exists (file), a folder holds a file (dir), a file parses as JSON (json), or a file matches a pattern.
export function setupMiss(root, check) {
  if (check.dir) return list(root, check.dir).length === 0;
  const text = read(root, check.file);
  if (text === null) return true;
  if (check.json) {
    try {
      JSON.parse(text);
    } catch {
      return true;
    }
  }
  return check.pattern ? !new RegExp(check.pattern, 'im').test(text) : false;
}

// The files a part's rules are read from: its own list, or the param named by files_param (empty when unset).
export const partFiles = (set, params = {}) => (set.files_param ? params[set.files_param] ?? [] : set.files ?? []);

// The rules a part's files leave unsaid, by label. null when none of the part's files exists.
export function ruleMisses(root, set, params = {}) {
  const texts = partFiles(set, params).map((f) => read(root, f)).filter((t) => t !== null);
  if (!texts.length) return null;
  const all = texts.join('\n');
  return (set.rules ?? []).filter((r) => !new RegExp(r.pattern, 'i').test(all)).map((r) => r.label);
}

// Plugins settings.json turns on that are neither from the official marketplace nor this repo's own, and each
// server .mcp.json lists, since a cloud thread skips it. null when neither file exists to read.
export function pluginsUntrusted(root, params) {
  const settingsText = read(root, params.settings_file);
  const mcpText = read(root, '.mcp.json');
  if (settingsText === null && mcpText === null) return null;
  const bad = [];
  if (settingsText !== null) {
    try {
      const allow = new RegExp(params.plugin_allow);
      for (const [id, on] of Object.entries(JSON.parse(settingsText).enabledPlugins ?? {})) if (on && !allow.test(id)) bad.push(id);
    } catch {
      bad.push(params.settings_file);
    }
  }
  if (mcpText !== null) {
    try {
      bad.push(...Object.keys(JSON.parse(mcpText).mcpServers ?? {}).map((s) => `.mcp.json: ${s}`));
    } catch {
      bad.push('.mcp.json');
    }
  }
  return bad;
}

export function partMetrics({ root, params, val, cnc }) {
  const setup = params.setup_checks ?? [];
  const missing = setup.filter((c) => setupMiss(root, c)).map((c) => c.label);
  val('code_project.setup_missing', missing.length, undefined, lines(missing));

  const sets = params.part_rules ?? {};
  for (const [id, set] of Object.entries(sets)) {
    const files = partFiles(set, params);
    const miss = ruleMisses(root, set, params);
    if (!files.length) cnc(id, `no file to read: set params.${set.files_param ?? 'part_rules'} on targets/code-project.json`);
    else if (miss === null) cnc(id, `none of ${files.join(', ')} exists`);
    else val(id, miss.length, undefined, lines(miss));
  }

  const bad = pluginsUntrusted(root, params);
  if (bad === null) cnc('code_project.plugins_untrusted', `no ${params.settings_file} or .mcp.json to read`);
  else val('code_project.plugins_untrusted', bad.length, undefined, lines(bad));
}
