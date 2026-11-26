// node --import ./tests/engine-lib.mjs --test collectors/code-project/code-project.test.mjs
// Every input is synthetic: a temp repo of instruction and agent files, and a fake gh client.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { area, collect, metricIds, parseAgent, unsafeAgent } from './code-project.mjs';

const TARGETS = JSON.parse((await import('node:fs')).readFileSync(new URL('../../targets/code-project.json', import.meta.url), 'utf8'));
const params = { ...Object.assign({}, ...TARGETS.map((t) => t.params ?? {})), repo: 'acme/app' };
const NOW = Date.parse('2026-11-25T12:00:00Z');

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'cp-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}
const agent = (front, body = 'Search and report.') => `---\n${front}\n---\n${body}\n`;
const GOOD = 'Never push to main.\nNever print, copy or commit a key value.\n';

const pr = (n, ref, created, merged) => ({ number: n, head: { ref }, created_at: created, merged_at: merged });
const fakeGh = (pulls, firsts = {}) => ({
  rest: async (route) => {
    if (route.startsWith('repos/acme/app/pulls?')) return structuredClone(pulls);
    const m = /pulls\/(\d+)\/commits/.exec(route);
    if (m && firsts[m[1]]) return [{ commit: { author: { date: firsts[m[1]] } } }];
    throw Object.assign(new Error(`HTTP 404: ${route}`), { status: 404 });
  },
});
const run = (root, gh, extra = {}) => collect({ root, params: { ...params, ...extra }, gh, now: NOW });

test('code-project: every metric of the targets file, from one repo', async () => {
  assert.equal(area, 'code-project');
  const root = repo({
    'CLAUDE.md': GOOD,
    '.claude/agents/explorer.md': agent('name: explorer\ndescription: Read only search.\ntools: Read, Grep\nmodel: haiku'),
    '.claude/agents/fixer.md': agent('name: fixer\ndescription: Read-only review.\ntools: Read, Edit'),
  });
  const gh = fakeGh(
    [pr(1, 'claude/a', '2026-11-20T10:05:00Z', '2026-11-21T10:05:00Z'), pr(2, 'claude/b', '2026-11-22T09:20:00Z', '2026-11-22T21:20:00Z'), pr(3, 'feat/x', '2026-11-22T09:00:00Z', '2026-11-22T10:00:00Z')],
    { 1: '2026-11-20T10:00:00Z', 2: '2026-11-22T09:00:00Z' },
  );
  const out = await run(root, gh);
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  assert.equal(out['code_project.guard_rules_missing'].value, 0);
  assert.equal(out['code_project.instruction_lines'].value, 2);
  assert.equal(out['code_project.agents_unsafe'].value, 1);
  assert.deepEqual(out['code_project.agents_unsafe'].detail, [{ label: '.claude/agents/fixer.md', value: 1, unit: 'agents' }]);
  assert.equal(out['code_project.agents_without_model'].value, 1);
  assert.equal(out['code_project.draft_pr_minutes'].value, 12.5, 'median of 5 and 20 minutes; the feat/ pull request is not a thread');
  assert.equal(out['code_project.ready_to_merge_hours'].value, 18, 'median of 24 and 12 hours');
  assert.equal(out['code_project.requests'].value, 3, 'one list and two first commits');
});

test('code-project: a missing guard rule is listed by label, and the longest file counts', async () => {
  const long = `${'rule\n'.repeat(250)}`;
  const out = await run(repo({ 'CLAUDE.md': 'Never push to main.\n', 'AGENTS.md': long }), fakeGh([]));
  assert.equal(out['code_project.guard_rules_missing'].value, 1);
  assert.deepEqual(out['code_project.guard_rules_missing'].detail, [{ label: 'Never print or commit a key', value: 1, unit: 'rules' }]);
  assert.equal(out['code_project.instruction_lines'].value, 250);
});

test('code-project: nothing to read is not measured, never 0', async () => {
  const out = await run(repo({}), fakeGh([]));
  for (const id of ['code_project.guard_rules_missing', 'code_project.instruction_lines', 'code_project.agents_unsafe', 'code_project.agents_without_model', 'code_project.draft_pr_minutes', 'code_project.ready_to_merge_hours']) assert.ok(out[id].could_not_check, id);
  assert.match(out['code_project.draft_pr_minutes'].could_not_check, /no claude\/ pull request merged in 30 days/);
  assert.equal(out['code_project.requests'].value, 1);
});

test('code-project: a merge older than the window, or a gh failure, leaves the speed metrics not measured', async () => {
  const old = await run(repo({ 'CLAUDE.md': GOOD }), fakeGh([pr(1, 'claude/a', '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z')]));
  assert.ok(old['code_project.ready_to_merge_hours'].could_not_check);
  const down = await collect({ root: repo({ 'CLAUDE.md': GOOD }), params, gh: { rest: async () => { throw new Error('HTTP 403: rate limited'); } }, now: NOW });
  assert.match(down['code_project.draft_pr_minutes'].could_not_check, /rate limited/);
  assert.equal(down['code_project.guard_rules_missing'].value, 0, 'repo files read with no gh');
});

test('code-project: a read only agent with no tools list inherits every tool, and one that names a reading tool is safe', () => {
  assert.equal(unsafeAgent(parseAgent(agent('name: a\ndescription: Read-only look.'))), true);
  assert.equal(unsafeAgent(parseAgent(agent('name: a\ndescription: Read-only look.\ntools: Read, Grep, Glob'))), false);
  assert.equal(unsafeAgent(parseAgent(agent('name: a\ndescription: Builds things.\ntools: Edit'))), false, 'not claimed read only');
  assert.equal(unsafeAgent(parseAgent(agent('name: a\ndescription: Read-only look.\ndisallowedTools: Write, Edit, NotebookEdit'))), false, 'no tools list, every writing tool denied');
  assert.equal(unsafeAgent(parseAgent(agent('name: a\ndescription: Read-only look.\ndisallowedTools: Write'))), true, 'Edit still inherited');
});
