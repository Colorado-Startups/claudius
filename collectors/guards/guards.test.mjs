// guards.call_ms: timed only in a --local run, a median of the runs, and a reason for each read it cannot make.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { area, collect, metricIds, timeOnce } from './guards.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-'));
after(() => fs.rmSync(home, { recursive: true, force: true }));
fs.mkdirSync(path.join(home, '.claude', 'code-os'), { recursive: true });
fs.writeFileSync(path.join(home, '.claude', 'code-os', 'bash_guard.py'), '');
const ok = () => ({ status: 0 });

test('guards: the area and its one metric', () => {
  assert.equal(area, 'guards');
  assert.deepEqual(metricIds, ['guards.call_ms']);
});

test('guards: a CI run never times the guard', async () => {
  let ran = 0;
  const out = await collect({ mode: 'ci', home, run: () => (ran++, ok()) });
  assert.match(out['guards.call_ms'].could_not_check, /--local/);
  assert.equal(ran, 0);
});

test('guards: a local run times params.runs calls and reports the median', async () => {
  let ran = 0;
  const out = await collect({ mode: 'local', home, params: { runs: 3 }, run: () => (ran++, ok()) });
  assert.equal(ran, 3);
  assert.equal(typeof out['guards.call_ms'].value, 'number');
  assert.deepEqual(out['guards.call_ms'].detail.map((d) => d.label), ['fastest run', 'median', 'slowest run']);
});

test('guards: a missing guard, a missing python3 and a failing guard each say why', async () => {
  const gone = await collect({ mode: 'local', home, params: { guard: '~/nowhere.py' }, run: ok });
  assert.match(gone['guards.call_ms'].could_not_check, /no guard at ~\/nowhere\.py/);
  assert.match(timeOnce('g', () => ({ error: { code: 'ENOENT' } })).error, /python3 is not on PATH/);
  assert.match(timeOnce('g', () => ({ status: 2 })).error, /exited 2/);
});
