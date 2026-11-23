// node --test tests/watch.test.mjs
// The plan skill's watcher (plugin/skills/plan/scripts/watch_workers.py), with its fake clock (--now). Local
// worktrees run on a temporary git repo; cloud workers run against a fake `gh` first on PATH. No network.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../plugin/skills/plan/scripts/watch_workers.py', import.meta.url));
const T0 = 1_800_000_000;
const SHA = 'a'.repeat(40);

// Runs the script; returns its JSON lines.
function watch(args, env = {}) {
  const r = spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => (l.startsWith('{') ? JSON.parse(l) : l));
}

// A fresh repo with one committed file, its workers file and its own state file.
function local(name = 'w') {
  const dir = mkdtempSync(join(tmpdir(), 'watch-'));
  const repo = join(dir, 'repo');
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=watch', '-c', 'user.email=watch', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q', repo);
  writeFileSync(join(repo, 'f.txt'), 'one');
  git('-C', repo, 'add', 'f.txt');
  git('-C', repo, 'commit', '-q', '-m', 'one');
  const workers = join(dir, 'workers.json');
  writeFileSync(workers, JSON.stringify([{ name, path: repo }]));
  const state = join(dir, 'state.json');
  const run = (now, ...extra) => watch(['--workers', workers, '--state', state, '--once', '--now', String(now), ...extra])[0];
  return { dir, repo, git, run, workers, state };
}

// A cloud worker read through a fake gh that answers with the PR this test sets.
function cloud(pr) {
  const dir = mkdtempSync(join(tmpdir(), 'watch-gh-'));
  writeFileSync(join(dir, 'gh'), [
    '#!/bin/sh',
    '[ -n "$FAKE_FAIL" ] && { echo "gh: connection refused" >&2; exit 1; }',
    'case "$1 $2" in',
    '  "api repos/"*) echo "$FAKE_SHA" ;;',
    '  "pr list") echo \'[{"number":7}]\' ;;',
    '  "pr view") echo "$FAKE_PR" ;;',
    '  *) echo "unexpected: $*" >&2; exit 1 ;;',
    'esac',
  ].join('\n'));
  chmodSync(join(dir, 'gh'), 0o755);
  const workers = join(dir, 'workers.json');
  writeFileSync(workers, JSON.stringify([{ name: 'c', repo: 'owner/repo', branch: 'claude/c' }]));
  const env = { PATH: `${dir}:${process.env.PATH}`, FAKE_SHA: SHA, FAKE_PR: JSON.stringify(pr) };
  const state = join(dir, 'state.json');
  const run = (now, ...extra) => watch(['--workers', workers, '--state', state, '--now', String(now), ...extra], env);
  const fail = (now) => watch(['--workers', workers, '--state', state, '--now', String(now), '--once'], { ...env, FAKE_FAIL: '1' });
  return { run, fail };
}
const pr = (over) => ({ state: 'OPEN', isDraft: false, headRefOid: SHA, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], ...over });

test('watch: a quiet minute is a nudge, a second minute after it is a restart', () => {
  const { run } = local();
  const first = run(T0);
  assert.equal(first.verdict, 'ok');
  assert.match(first.signal, /^commit [0-9a-f]{7}$/);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  assert.equal(run(T0 + 90).verdict, 'ok');
  assert.equal(run(T0 + 120).verdict, 'restart');
});

test('watch: a commit, a new edit and a second edit to a dirty file are each progress', () => {
  const { repo, git, run } = local();
  run(T0);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  git('-C', repo, 'commit', '-q', '--allow-empty', '-m', 'two');
  assert.deepEqual([run(T0 + 70).verdict, run(T0 + 70).idle_min], ['ok', 0]);
  writeFileSync(join(repo, 'f.txt'), 'two');
  const dirty = run(T0 + 200);
  assert.equal(dirty.idle_min, 0);
  assert.match(dirty.signal, /\+1 dirty$/);
  writeFileSync(join(repo, 'f.txt'), 'three');
  assert.equal(run(T0 + 330).idle_min, 0);
});

test('watch: a worker shown busy gets 10 minutes before a nudge', () => {
  const { run } = local();
  run(T0);
  assert.equal(run(T0 + 9 * 60, '--busy', 'w').verdict, 'ok');
  assert.equal(run(T0 + 10 * 60, '--busy', 'w').verdict, 'nudge');
});

test('watch: --reset forgets a worker, so a restarted one starts from zero', () => {
  const { run, workers, state } = local();
  run(T0);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  assert.deepEqual(watch(['--workers', workers, '--state', state, '--reset', 'w']), ['reset w']);
  assert.deepEqual([run(T0 + 61).verdict, run(T0 + 61).idle_min], ['ok', 0]);
});

test('watch: a worker that cannot be read is no progress, so it is nudged and then restarted', () => {
  const { dir, run, workers } = local();
  writeFileSync(workers, JSON.stringify([{ name: 'gone', path: join(dir, 'missing') }]));
  assert.equal(run(T0).verdict, 'ok');
  const later = run(T0 + 60);
  assert.equal(later.verdict, 'nudge');
  assert.match(later.signal, /^error: /);
  assert.equal(run(T0 + 120).verdict, 'restart');
});

test('watch: without --state, each workers file gets its own state', () => {
  const a = local('w');
  const b = local('w');
  const env = { TMPDIR: a.dir };
  watch(['--workers', a.workers, '--once', '--now', String(T0)], env);
  watch(['--workers', b.workers, '--once', '--now', String(T0)], env);
  assert.equal(readdirSync(a.dir).filter((f) => /^watch_workers\.[0-9a-f]{12}\.state\.json$/.test(f)).length, 2);
});

test('watch: a draft PR is never done, even with green CI', () => {
  const { run } = cloud(pr({ isDraft: true }));
  const [row] = run(T0, '--once');
  assert.equal(row.verdict, 'ok');
  assert.match(row.signal, /^PR #7 draft CI green/);
  assert.equal(run(T0 + 60, '--once')[0].verdict, 'nudge');
});

// Done is confirmed on a second check, a minute later.
const doneAfterTwo = (p) => {
  const { run } = cloud(p);
  assert.equal(run(T0, '--once')[0].verdict, 'ok');
  return run(T0 + 60, '--once')[0];
};

test('watch: a ready PR at the branch head with green or no CI is done on the second check, and loop mode exits', () => {
  assert.equal(doneAfterTwo(pr({})).verdict, 'done');
  assert.equal(doneAfterTwo(pr({ statusCheckRollup: [] })).verdict, 'done');
  const merged = doneAfterTwo(pr({ state: 'MERGED' }));
  assert.deepEqual([merged.verdict, merged.signal], ['done', 'PR #7 merged']);
  const rows = cloud(pr({})).run(T0, '--every', '0');
  assert.deepEqual(rows.map((r) => r.verdict), ['ok', 'done']);
});

test('watch: an old merged PR on a reused branch name is not done', () => {
  assert.notEqual(doneAfterTwo(pr({ state: 'MERGED', headRefOid: 'b'.repeat(40) })).verdict, 'done');
});

test('watch: a done worker stays done through a failed read, and is not nudged', () => {
  const { run, fail } = cloud(pr({}));
  run(T0, '--once');
  assert.equal(run(T0 + 60, '--once')[0].verdict, 'done');
  for (const t of [T0 + 120, T0 + 180, T0 + 240]) assert.equal(fail(t)[0].verdict, 'done');
});

test('watch: a corrupt state file says so and starts fresh', () => {
  const { run, state, workers } = local();
  writeFileSync(state, '{not json');
  const r = spawnSync('python3', ['-I', SCRIPT, '--workers', workers, '--state', state, '--once', '--now', String(T0)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /unreadable/);
  assert.equal(run(T0 + 60).verdict, 'nudge');
});

test('watch: CI failing or pending, or a PR behind the branch, is not done', () => {
  assert.match(cloud(pr({ statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })).run(T0, '--once')[0].signal, /CI failing/);
  assert.equal(cloud(pr({ statusCheckRollup: [{ status: 'IN_PROGRESS' }] })).run(T0, '--once')[0].verdict, 'ok');
  assert.equal(cloud(pr({ headRefOid: 'b'.repeat(40) })).run(T0, '--once')[0].verdict, 'ok');
});
