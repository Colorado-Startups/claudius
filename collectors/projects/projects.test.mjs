// node --test collectors/projects/projects.test.mjs
// Every input is synthetic: a repo checkout written to a temp folder, ready or with one file missing.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { area, checks, collect, metricIds } from './projects.mjs';

const READY = {
  'AGENTS.md': '# Rules\n\n| Shipping | Branch, then a pull request. Never push to `main` |\n',
  'CLAUDE.md': '@AGENTS.md\n',
  '.github/PULL_REQUEST_TEMPLATE.md': '## What\n\nOne line.\n\n## Why\n\nOne line.\n',
  '.github/ISSUE_TEMPLATE/bug.yml': 'name: Bug\nbody: []\n',
  '.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: false\n',
  '.github/workflows/ci.yml': 'name: ci\n',
  '.claude/settings.json': '{ "permissions": { "deny": [] } }\n',
};

function repo(files = READY, without = []) {
  const root = mkdtempSync(join(tmpdir(), 'projects-'));
  for (const [name, body] of Object.entries(files)) {
    if (without.includes(name)) continue;
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  return root;
}

test('projects: every metric of the targets file, read from a ready repo', async () => {
  assert.equal(area, 'projects');
  const out = await collect({ root: repo() });
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  assert.equal(out['projects.setup_gaps'].value, 0);
  assert.equal(out['projects.setup_gaps'].detail, undefined, 'no gap, no detail rows');
  assert.equal(out['projects.pr_template_words'].value, 8);
  assert.ok(out['projects.audit_seconds'].value >= 0);
});

test('projects: each missing file is one named gap, never not measured', async () => {
  for (const [file, label] of [
    ['AGENTS.md', 'AGENTS.md exists'],
    ['.github/PULL_REQUEST_TEMPLATE.md', 'pull request template'],
    ['.github/ISSUE_TEMPLATE/bug.yml', 'issue form'],
    ['.github/workflows/ci.yml', 'CI workflow'],
    ['.claude/settings.json', '.claude/settings.json is valid JSON'],
  ]) {
    const out = await collect({ root: repo(READY, [file]) });
    assert.equal(out['projects.setup_gaps'].value, file === 'AGENTS.md' ? 2 : 1, file);
    assert.ok(out['projects.setup_gaps'].detail.some((d) => d.label === label), label);
  }
});

test('projects: a CLAUDE.md that does not import the rules file, or invalid settings, is a gap', () => {
  const miss = (files) => checks(repo({ ...READY, ...files })).filter(([, ok]) => !ok).map(([l]) => l);
  assert.deepEqual(miss({ 'CLAUDE.md': 'See AGENTS.md\n' }), ['CLAUDE.md imports AGENTS.md']);
  assert.deepEqual(miss({ '.claude/settings.json': '{ nope' }), ['.claude/settings.json is valid JSON']);
  assert.deepEqual(miss({ '.claude/settings.json': '[]' }), ['.claude/settings.json is valid JSON']);
  assert.deepEqual(miss({ 'AGENTS.md': '# Rules\n', 'CLAUDE.md': '@AGENTS.md\n' }), ['rule: never push to main']);
});

test('projects: the rule may sit in either file, and a lower-case template path counts', async () => {
  const files = { ...READY, 'AGENTS.md': '# Rules\n', 'CLAUDE.md': '@AGENTS.md\n\nNever push to main.\n' };
  delete files['.github/PULL_REQUEST_TEMPLATE.md'];
  files['.github/pull_request_template.md'] = 'one two three';
  const out = await collect({ root: repo(files) });
  assert.equal(out['projects.setup_gaps'].value, 0);
  assert.equal(out['projects.pr_template_words'].value, 3);
});

test('projects: an issue folder with only config.yml has no form; no template leaves its words not measured', async () => {
  const out = await collect({ root: repo(READY, ['.github/ISSUE_TEMPLATE/bug.yml', '.github/PULL_REQUEST_TEMPLATE.md']) });
  assert.equal(out['projects.setup_gaps'].value, 2);
  assert.match(out['projects.pr_template_words'].could_not_check, /no pull request template/);
});

test('projects: an empty folder fails every check and leaks no path', async () => {
  const root = repo({});
  const out = await collect({ root });
  assert.equal(out['projects.setup_gaps'].value, 7);
  assert.ok(!JSON.stringify(out).includes(root), 'no checkout path in any row');
});
