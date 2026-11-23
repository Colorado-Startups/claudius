// node --test tests/watch.test.mjs
// The plan skill's watcher (plugin/skills/plan/scripts/watch_workers.py) on a local worktree, with its fake clock
// (--now): a quiet minute is a nudge, one more is a restart, new work resets it, a busy worker gets 10 minutes,
// --reset forgets a worker, and a broken worker reports an error without a verdict against it. No network.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../plugin/skills/plan/scripts/watch_workers.py', import.meta.url));
const T0 = 1_800_000_000;

// A fresh repo with one commit, its workers file and its own state file.
function setup(name = 'w') {
  const dir = mkdtempSync(join(tmpdir(), 'watch-'));
  const repo = join(dir, 'repo');
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=watch', '-c', 'user.email=watch', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q', repo);
  git('-C', repo, 'commit', '-q', '--allow-empty', '-m', 'one');
  const workers = join(dir, 'workers.json');
  writeFileSync(workers, JSON.stringify([{ name, path: repo }]));
  const state = join(dir, 'state.json');
  const run = (now, ...extra) => {
    const r = spawnSync('python3', ['-I', SCRIPT, '--workers', workers, '--state', state, '--once', '--now', String(now), ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  return { repo, git, run, workers, state, dir };
}

test('watch: a quiet minute is a nudge, a second minute after it is a restart', () => {
  const { run } = setup();
  const first = run(T0);
  assert.equal(first.verdict, 'ok');
  assert.match(first.signal, /^commit [0-9a-f]{7}$/);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  assert.equal(run(T0 + 90).verdict, 'ok');
  assert.equal(run(T0 + 120).verdict, 'restart');
});

test('watch: a commit or an edit is progress and clears the nudge', () => {
  const { repo, git, run } = setup();
  run(T0);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  git('-C', repo, 'commit', '-q', '--allow-empty', '-m', 'two');
  const after = run(T0 + 70);
  assert.equal(after.verdict, 'ok');
  assert.equal(after.idle_min, 0);
  writeFileSync(join(repo, 'note.txt'), 'x');
  const dirty = run(T0 + 200);
  assert.equal(dirty.verdict, 'ok');
  assert.match(dirty.signal, /\+1 dirty$/);
});

test('watch: a worker shown busy gets 10 minutes before a nudge', () => {
  const { run } = setup();
  run(T0);
  assert.equal(run(T0 + 9 * 60, '--busy', 'w').verdict, 'ok');
  assert.equal(run(T0 + 10 * 60, '--busy', 'w').verdict, 'nudge');
});

test('watch: --reset forgets a worker, so a restarted one starts from zero', () => {
  const { run, workers, state } = setup();
  run(T0);
  assert.equal(run(T0 + 60).verdict, 'nudge');
  const r = spawnSync('python3', ['-I', SCRIPT, '--workers', workers, '--state', state, '--reset', 'w'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const fresh = run(T0 + 61);
  assert.equal(fresh.verdict, 'ok');
  assert.equal(fresh.idle_min, 0);
});

test('watch: a worker whose path is gone reports an error and never a nudge or restart', () => {
  const { dir, run, workers } = setup();
  writeFileSync(workers, JSON.stringify([{ name: 'gone', path: join(dir, 'missing') }]));
  run(T0);
  const row = run(T0 + 300);
  assert.equal(row.verdict, 'ok');
  assert.match(row.signal, /^error: /);
});
