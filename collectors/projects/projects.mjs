// Projects tab: whether this repo is ready to be a Claude Code Project's repo.
//   Quality: setup gaps, the files a cloud thread reads first or writes into. Speed: seconds per check.
//   Consumption: words in the pull request template, which every thread reads when it opens a pull request.
// Reads files of this checkout only, so CI reads them too (needs none). A missing file is a gap, never an error.
// Privacy: detail rows name checks, never a path outside the repo or any file text.
import fs from 'node:fs';
import path from 'node:path';
import { redact, useLib } from '../lib/engine.mjs';

export const area = 'projects';

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/projects.json', import.meta.url), 'utf8'));
export const metricIds = TARGETS.map((t) => t.id);
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const SOURCE = 'quality/collectors/projects/projects.mjs';

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(gather(opts), opts.home);
}

const text = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const first = (root, names) => [names].flat().map((n) => path.join(root, n)).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
const files = (dir, test) => {
  try {
    return fs.readdirSync(dir).filter(test);
  } catch {
    return [];
  }
};
const words = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each check of the Code Project setup: a label, and whether the repo meets it.
export function checks(root, p = TEMPLATE) {
  const agents = text(path.join(root, p.agents_file));
  const claude = text(path.join(root, p.claude_file));
  let settings = false;
  try {
    const parsed = JSON.parse(text(path.join(root, p.settings)) ?? '');
    settings = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    settings = false;
  }
  return [
    [`${p.agents_file} exists`, agents !== null],
    [`${p.claude_file} imports ${p.agents_file}`, claude !== null && new RegExp(`^@${esc(p.agents_file)}\\s*$`, 'm').test(claude)],
    ['rule: never push to main', /never\s+push(?:ing)?\s+to\s+`?main/i.test(`${agents ?? ''}\n${claude ?? ''}`)],
    ['pull request template', Boolean(first(root, p.pr_template))],
    ['issue form', files(path.join(root, p.issue_forms), (f) => /\.ya?ml$/.test(f) && !/^config\.ya?ml$/.test(f)).length > 0],
    ['CI workflow', files(path.join(root, p.workflows), (f) => /\.ya?ml$/.test(f)).length > 0],
    [`${p.settings} is valid JSON`, settings],
  ];
}

function gather({ root = '.', params = TEMPLATE } = {}) {
  const started = Date.now();
  const readAt = new Date().toISOString();
  const p = { ...TEMPLATE, ...params };
  const out = {};
  const val = (id, value, source, detail) => (out[id] = { value, ...(detail?.length ? { detail } : {}), source, read_at: readAt });
  const cnc = (id, reason, source) => (out[id] = { could_not_check: reason, source });

  const done = checks(root, p);
  const missing = done.filter(([, ok]) => !ok);
  val('projects.setup_gaps', missing.length, `${done.length} checks of this repo's files: ${done.map(([l]) => l).join('; ')}`, missing.map(([label]) => ({ label, value: 1, unit: 'items' })));

  const prFile = first(root, p.pr_template);
  const prSource = `words of the pull request template named by params.pr_template (${SOURCE})`;
  if (prFile) val('projects.pr_template_words', words(text(prFile) ?? ''), prSource);
  else cnc('projects.pr_template_words', 'no pull request template in this repo', prSource);

  val('projects.audit_seconds', Math.round((Date.now() - started) / 100) / 10, `wall time of ${SOURCE}, from the first file read to the last`);
  return Object.fromEntries(metricIds.map((id) => [id, out[id] ?? { could_not_check: 'collector produced no value', source: SOURCE }]));
}
