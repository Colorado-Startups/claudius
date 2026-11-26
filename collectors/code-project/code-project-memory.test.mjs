// node --import ./tests/engine-lib.mjs --test collectors/code-project/code-project-memory.test.mjs
// Every input is a synthetic folder in a temp directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { area, collect, metricIds } from './code-project-memory.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const dir = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-memory-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(d, name), text);
  return d;
};
const go = (params) => collect({ params, now: NOW, home: os.tmpdir() });

test('cp-memory: the index bytes / 4, rounded up, and the notes it points to are not counted', async () => {
  assert.equal(area, 'cp-memory');
  const out = await go({ memory_dir: dir({ 'MEMORY.md': 'x'.repeat(401), 'note.md': 'y'.repeat(4000) }) });
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  assert.equal(out['cp_memory.start_tokens'].value, 101);
  assert.deepEqual(out['cp_memory.start_tokens'].detail, [{ label: 'MEMORY.md', value: 101, unit: 'tokens' }]);
  assert.equal(out['cp_memory.start_tokens'].read_at, '2026-11-25T12:00:00.000Z');
});

test('cp-memory: only the first 200 lines or 25 KB of the index load at start', async () => {
  const lines = await go({ memory_dir: dir({ 'MEMORY.md': 'abcd\n'.repeat(300) }) });
  assert.equal(lines['cp_memory.start_tokens'].value, 250, '200 lines of 4 bytes and 199 newlines, 999 bytes / 4');
  const big = await go({ memory_dir: dir({ 'MEMORY.md': 'x'.repeat(40000) }) });
  assert.equal(big['cp_memory.start_tokens'].value, 6250);
});

test('cp-memory: no folder param, or no index in it, is not measured and never 0', async () => {
  const none = await go({});
  for (const id of metricIds) {
    assert.match(none[id].could_not_check, /no memory_dir/);
    assert.ok(!('value' in none[id]), id);
  }
  const empty = await go({ memory_dir: dir({ 'note.md': 'x' }) });
  assert.match(empty['cp_memory.start_tokens'].could_not_check, /no MEMORY\.md/);
  assert.equal(empty['cp_memory.stale_notes'].detail[0].label, 'of 1 notes', 'the notes can still be counted');
  const gone = await go({ memory_dir: path.join(os.tmpdir(), 'cp-memory-not-there') });
  assert.match(gone['cp_memory.stale_notes'].could_not_check, /could not list/);
});

test('cp-memory: stale notes are those whose modified line, or else file time, is over stale_days old; the index and note text are not counted', async () => {
  const d = dir({
    'MEMORY.md': 'index',
    'old.md': '---\nname: a\nmetadata:\n  modified: 2026-10-01T00:00:00Z\n---\nbody',
    'fresh.md': '---\nname: b\nmodified: 2026-11-20T00:00:00Z\n---\nbody',
    'nodate.md': 'no front matter',
  });
  fs.utimesSync(path.join(d, 'nodate.md'), new Date('2026-09-01'), new Date('2026-09-01'));
  const out = await go({ memory_dir: d, stale_days: 30 });
  assert.equal(out['cp_memory.stale_notes'].value, 2);
  assert.deepEqual(out['cp_memory.stale_notes'].detail, [{ label: 'of 3 notes', value: 2, unit: 'notes' }]);
  assert.ok(!JSON.stringify(out).includes('body'));
});

test('cp-memory: a folder with only the index has no note to date, so the stale count is not measured', async () => {
  const out = await go({ memory_dir: dir({ 'MEMORY.md': 'index' }) });
  assert.match(out['cp_memory.stale_notes'].could_not_check, /no note besides the index/);
});
