// The privacy gate on fixture runs: a clean CI run passes, and each seeded
// local value, home path, email or account name fails it.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { localOnlyIds, privacyProblems } from './privacy.mjs';

// A targets folder with one local-only metric and one read from GitHub.
function targetsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-'));
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify([{ id: 'fixture.local', needs: 'local-files' }, { id: 'fixture.gh', needs: 'gh' }]));
  return dir;
}

// A CI run as collect.mjs writes it: the local metric unread, the GitHub one read.
const cleanRun = () => ({
  generated_at: '2026-11-12T00:00:00.000Z',
  mode: 'ci',
  metrics: {
    'fixture.local': { could_not_check: 'read by a --local collect only', source: 'state: ~/.claude/projects, -Users-<user>-Developer' },
    'fixture.gh': { value: 3, source: 'last 20 merged pull requests', read_at: '2026-11-12T00:00:00.000Z' },
  },
});

const localIds = localOnlyIds([targetsDir()]);

test('privacy: the targets name the local-only ids', () => {
  assert.deepEqual([...localIds], ['fixture.local']);
});

test('privacy: a clean CI run passes', () => {
  assert.deepEqual(privacyProblems(cleanRun(), { localIds }), []);
});

test('privacy: a seeded local value fails', () => {
  const run = cleanRun();
  run.metrics['fixture.local'] = { value: 12, source: 'transcripts' };
  assert.deepEqual(privacyProblems(run, { localIds }), ['fixture.local needs local files but carries a value']);
});

test('privacy: a local run fails', () => {
  assert.deepEqual(privacyProblems({ ...cleanRun(), mode: 'local' }, { localIds }), ['run mode is "local", not "ci"']);
});

test('privacy: home paths fail in each form, a redacted one passes', () => {
  for (const path of ['/Users/someone/x', '/home/someone/x', 'C:\\Users\\someone\\x', '-Users-someone-Developer']) {
    const run = cleanRun();
    run.metrics['fixture.gh'].source = path;
    assert.equal(privacyProblems(run, { localIds }).length, 1, path);
  }
  const run = cleanRun();
  run.metrics['fixture.gh'].source = '/home/runner/work/claudius';
  assert.deepEqual(privacyProblems(run, { localIds }), []);
});

test('privacy: an email fails; a git remote and a noreply address pass', () => {
  const run = cleanRun();
  run.metrics['fixture.gh'].source = 'git@github.com:owner/repo noreply@example.com 1+someone@users.noreply.github.com';
  assert.deepEqual(privacyProblems(run, { localIds }), []);
  run.metrics['fixture.gh'].source = 'someone@example.com';
  assert.deepEqual(privacyProblems(run, { localIds }), ['email someone@example.com']);
});

test('privacy: a listed account name fails, as a whole word', () => {
  const run = cleanRun();
  run.metrics['fixture.gh'].source = 'read by someone';
  assert.deepEqual(privacyProblems(run, { localIds, names: ['someone'] }), ['account name someone']);
  assert.deepEqual(privacyProblems(run, { localIds, names: ['some', ''] }), []);
});
