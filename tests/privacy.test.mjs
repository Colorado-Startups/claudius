// The privacy gate on fixture runs: a clean CI run passes, and each seeded
// local-only metric, home path, email or account name fails it, by file, line
// and kind, never by the text it matched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { localOnlyIds, privacyProblems, textProblems } from './privacy.mjs';

// A targets folder with one local-only metric and one read from GitHub.
function targetsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-'));
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify([{ id: 'fixture.local', needs: 'local-files' }, { id: 'fixture.gh', needs: 'gh' }]));
  return dir;
}

// A public CI run as collect.mjs writes it from quality/public.mjs's config: the local metric dropped, the GitHub one read.
const cleanRun = () => ({
  generated_at: '2026-11-12T00:00:00.000Z',
  mode: 'ci',
  metrics: {
    'fixture.gh': { value: 3, source: 'last 20 merged pull requests, ~/.claude never read', read_at: '2026-11-12T00:00:00.000Z' },
  },
});

const localIds = localOnlyIds([targetsDir()]);

test('privacy: the targets name the local-only ids', () => {
  assert.deepEqual([...localIds], ['fixture.local']);
});

test('privacy: a clean CI run passes', () => {
  assert.deepEqual(privacyProblems(cleanRun(), { localIds }), []);
});

test('privacy: a local-only metric fails, read or not', () => {
  const run = cleanRun();
  run.metrics['fixture.local'] = { value: 12, source: 'transcripts' };
  assert.deepEqual(privacyProblems(run, { localIds }), ['fixture.local needs local files but is in the run']);
  run.metrics['fixture.local'] = { could_not_check: 'read by a --local collect only', source: 'state: ~/.claude/projects, -Users-<user>-Developer' };
  assert.deepEqual(privacyProblems(run, { localIds }), ['fixture.local needs local files but is in the run'], 'listed as not read is still listed');
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
  assert.deepEqual(privacyProblems(run, { localIds }), ['line 7: email']);
});

test('privacy: the pack targets name 47 local-only ids, and a seeded one fails', () => {
  const ids = localOnlyIds([fileURLToPath(new URL('../targets/', import.meta.url))]);
  assert.equal(ids.size, 47);
  const run = { mode: 'ci', metrics: { 'claude.cost_per_merged_pr_usd': { value: 1.5, source: 'transcripts' } } };
  assert.ok(ids.has('claude.cost_per_merged_pr_usd'));
  assert.deepEqual(privacyProblems(run, { localIds: ids }), ['claude.cost_per_merged_pr_usd needs local files but is in the run']);
});

test('privacy: a listed account name fails, as a whole word in any case, and the finding never names it', () => {
  const run = cleanRun();
  run.metrics['fixture.gh'].source = 'read by Someone';
  const found = privacyProblems(run, { localIds, names: ['someone'] });
  assert.deepEqual(found, ['line 7: a name in PRIVACY_NAMES']);
  assert.doesNotMatch(found.join(), /someone/i);
  assert.deepEqual(privacyProblems(run, { localIds, names: ['some', ''] }), []);
});

// A slice of a real deployed page (fixtures/privacy/page-slice.html) with one planted home path and one planted email.
const slice = readFileSync(fileURLToPath(new URL('../fixtures/privacy/page-slice.html', import.meta.url)), 'utf8');

test('privacy: a real page slice fails on its planted home path and email, and passes without them', () => {
  const found = textProblems(slice);
  assert.deepEqual(found.map((f) => f.replace(/^line \d+: /, '')), ['home path', 'email']);
  assert.doesNotMatch(found.join(), /example/);
  assert.deepEqual(textProblems(slice.replace(/<p class="src planted">.*?<\/p>/g, '')), []);
});

test('privacy: the gate fails a home path planted in a file under --dist', () => {
  const root = mkdtempSync(join(tmpdir(), 'privacy-dist-'));
  writeFileSync(join(root, 'latest.json'), JSON.stringify(cleanRun()));
  mkdirSync(join(root, 'dist', 'tab'), { recursive: true });
  writeFileSync(join(root, 'dist', 'index.html'), '<p>clean</p>');
  const gate = () => spawnSync(process.execPath, [fileURLToPath(new URL('./privacy.mjs', import.meta.url)), join(root, 'latest.json'), '--dist', join(root, 'dist')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(gate().status, 0);
  writeFileSync(join(root, 'dist', 'tab', 'page.html'), '<p class="src">/Users/example/project</p>');
  const run = gate();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /page\.html:1: home path$/m);
  assert.doesNotMatch(run.stderr, /\/Users\/example/);
});

test('privacy: the gate fails a local-only metric id in a file under --dist', () => {
  const root = mkdtempSync(join(tmpdir(), 'privacy-id-'));
  writeFileSync(join(root, 'latest.json'), JSON.stringify(cleanRun()));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.html'), '<tr data-id="fixture.gh"></tr>');
  const gate = () => spawnSync(process.execPath, [fileURLToPath(new URL('./privacy.mjs', import.meta.url)), join(root, 'latest.json'), targetsDir(), '--dist', join(root, 'dist')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(gate().status, 0);
  writeFileSync(join(root, 'dist', 'index.html'), '<tr data-id="fixture.local"><td>not read</td></tr>');
  const run = gate();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /index\.html:1: local-only metric fixture\.local$/m);
});

// The gate as CI runs it, with PRIVACY_NAMES from the repo's Actions secret: names here are planted ones.
function nameGate(names, page) {
  const root = mkdtempSync(join(tmpdir(), 'privacy-name-'));
  writeFileSync(join(root, 'latest.json'), JSON.stringify(cleanRun(), null, 2));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'process.html'), page);
  const env = { PATH: process.env.PATH, ...(names === null ? {} : { PRIVACY_NAMES: names }) };
  return spawnSync(process.execPath, [fileURLToPath(new URL('./privacy.mjs', import.meta.url)), join(root, 'latest.json'), '--dist', join(root, 'dist')], { encoding: 'utf8', env });
}

test('privacy: a planted name fails the gate, which prints its file and line and never the name', () => {
  const page = '<p>clean</p>\n<p>merged by PlantedName</p>\n';
  const run = nameGate('plantedname, other-planted', page);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /process\.html:2: a name in PRIVACY_NAMES$/m);
  assert.doesNotMatch(run.stdout + run.stderr, /planted/i);
  assert.match(run.stdout, /2 names, 1 dist files, 1 findings/);
  assert.equal(nameGate('plantedname', '<p>clean</p>\n').status, 0);
});

test('privacy: with no PRIVACY_NAMES, as on a fork pull request, the name check is skipped and says so', () => {
  for (const names of [null, '', ' , ']) {
    const run = nameGate(names, '<p>merged by PlantedName</p>\n');
    assert.equal(run.status, 0, JSON.stringify(names));
    assert.match(run.stdout, /PRIVACY_NAMES is not set, so the name check is skipped/);
  }
});
