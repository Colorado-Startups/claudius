// node --import ./tests/engine-lib.mjs --test collectors/code-project/code-project-records.test.mjs
// Every input is a synthetic record in a temp directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { area, collect, metricIds } from './code-project-records.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cp-records-'));
const put = (root, name, doc) => {
  fs.mkdirSync(path.join(root, 'quality/data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'quality/data', name), JSON.stringify(doc));
};
const go = (root, params = {}) => collect({ root, params, now: NOW, home: tmp() });
const READ = '2026-11-24T12:00:00Z';

test('cp-records: five lines, one per id, and nothing to read is not measured and never 0', async () => {
  assert.equal(area, 'cp-records');
  const out = await go(tmp());
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  for (const id of metricIds) {
    assert.match(out[id].could_not_check, /no record file on this machine/);
    assert.ok(!('value' in out[id]), id);
  }
});

test('cp-records: settings gaps count the rows whose actual value is not the expected one, and keep no value', async () => {
  const root = tmp();
  put(root, 'project-settings.json', { read_at: READ, settings: [
    { name: 'usage limit', expected: 0, actual: 0 },
    { name: 'memory', expected: 'on', actual: 'off' },
    { name: 'auto fix', expected: ['a'], actual: ['b'] },
  ] });
  const out = await go(root);
  assert.equal(out['cp_general.settings_gaps'].value, 2);
  assert.deepEqual(out['cp_general.settings_gaps'].detail, [{ label: 'of 3 settings', value: 2, unit: 'settings' }]);
  assert.ok(!JSON.stringify(out).includes('usage limit'));
});

test('cp-records: environment gaps count the items that are not present', async () => {
  const root = tmp();
  put(root, 'environment.json', { read_at: READ, items: [{ name: 'host-a', present: true }, { name: 'VAR_B', present: false }, { name: 'script' }] });
  const out = await go(root);
  assert.equal(out['cp_environment.environment_gaps'].value, 2);
  assert.ok(!JSON.stringify(out).includes('VAR_B'));
});

test('cp-records: task failures and hours since the newest run come from one record', async () => {
  const root = tmp();
  put(root, 'scheduled-tasks.json', { read_at: '2026-11-25T00:00:00Z', tasks: [
    { name: 'weekly', last_run_at: '2026-11-22T12:00:00Z', last_status: 'ok' },
    { name: 'digest', last_run_at: '2026-11-24T18:00:00Z', last_status: 'failed' },
    { name: 'never', last_status: 'ok' },
  ] });
  const out = await go(root);
  assert.equal(out['cp_scheduled_tasks.task_failures'].value, 1);
  assert.equal(out['cp_scheduled_tasks.hours_since_last_run'].value, 6);
  assert.ok(!JSON.stringify(out).includes('digest'));
});

test('cp-records: a task record with no run time still counts failures but not the hours', async () => {
  const root = tmp();
  put(root, 'scheduled-tasks.json', { read_at: READ, tasks: [{ name: 'a', last_status: 'ok' }] });
  const out = await go(root);
  assert.equal(out['cp_scheduled_tasks.task_failures'].value, 0);
  assert.match(out['cp_scheduled_tasks.hours_since_last_run'].could_not_check, /no task in the record has a run time/);
});

test('cp-records: the largest thread share needs two threads and never keeps a name', async () => {
  const root = tmp();
  put(root, 'thread-tokens.json', { read_at: READ, threads: [{ name: 'secret-thread', tokens: 600 }, { tokens: 300 }, { tokens: 100 }] });
  const out = await go(root);
  assert.equal(out['cp_threads.largest_thread_token_share'].value, 60);
  assert.ok(!JSON.stringify(out).includes('secret-thread'));
  put(root, 'thread-tokens.json', { read_at: READ, threads: [{ tokens: 600 }] });
  assert.match((await go(root))['cp_threads.largest_thread_token_share'].could_not_check, /needs at least 2/);
  put(root, 'thread-tokens.json', { read_at: READ, threads: [{ tokens: 0 }, { tokens: 0 }] });
  assert.match((await go(root))['cp_threads.largest_thread_token_share'].could_not_check, /no tokens/);
});

test('cp-records: a record that is old, undated, empty or not JSON is not measured', async () => {
  const root = tmp();
  put(root, 'project-settings.json', { read_at: '2026-10-01T00:00:00Z', settings: [{ name: 'a', expected: 1, actual: 1 }] });
  put(root, 'environment.json', { items: [{ name: 'a', present: true }] });
  put(root, 'scheduled-tasks.json', { read_at: READ, tasks: [] });
  fs.writeFileSync(path.join(root, 'quality/data/thread-tokens.json'), '{ not json');
  const out = await go(root);
  assert.match(out['cp_general.settings_gaps'].could_not_check, /read more than 14 days ago/);
  assert.match(out['cp_environment.environment_gaps'].could_not_check, /no read_at/);
  assert.match(out['cp_scheduled_tasks.task_failures'].could_not_check, /no task/);
  assert.match(out['cp_threads.largest_thread_token_share'].could_not_check, /not valid JSON/);
});

test('cp-records: a param names another file, and the repo may widen the age limit', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'mine.json'), JSON.stringify({ read_at: '2026-11-01T00:00:00Z', items: [{ present: false }] }));
  assert.equal((await go(root, { environment_file: 'mine.json', max_record_days: 60 }))['cp_environment.environment_gaps'].value, 1);
  assert.match((await go(root, { environment_file: 'mine.json' }))['cp_environment.environment_gaps'].could_not_check, /read it again/);
});
