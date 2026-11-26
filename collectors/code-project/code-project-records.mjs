// Five Code Project lines that a small record file feeds, as the Credits tab is fed by its input files. Each record is
// a JSON file kept on the machine that read the setting (quality/data/ is never committed, tests/privacy.mjs), so every
// line needs local-files and the public page leaves it out. The output holds counts, hours and percentages only: no
// setting value, no task or thread name, no path.
//
//   cp_general.settings_gaps                 params.settings_file      { read_at, settings: [{ name, expected, actual }] }
//   cp_environment.environment_gaps          params.environment_file   { read_at, items: [{ name, present }] }
//   cp_scheduled_tasks.task_failures         params.tasks_file         { read_at, tasks: [{ name, last_run_at, last_status }] }
//   cp_scheduled_tasks.hours_since_last_run  params.tasks_file         the newest last_run_at, against the record's read_at
//   cp_threads.largest_thread_token_share    params.thread_tokens_file { read_at, threads: [{ tokens }] }
//
// A record that is missing, not valid JSON, empty, or older than params.max_record_days is not measured and never 0
// (Git Crafter quality/SCORING.md): a guessed value would score a setting nobody read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact, useLib } from '../lib/engine.mjs';

export const area = 'cp-records';
export const metricIds = [
  'cp_general.settings_gaps',
  'cp_environment.environment_gaps',
  'cp_scheduled_tasks.task_failures',
  'cp_scheduled_tasks.hours_since_last_run',
  'cp_threads.largest_thread_token_share',
];

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/code-project-tabs.json', import.meta.url), 'utf8'));
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const DEFINED = Object.fromEntries(TARGETS.map((t) => [t.id, t]));
const DAY = 864e5;
const HOUR = 36e5;
const round1 = (n) => Math.round(n * 10) / 10;

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(gather(opts), opts.home);
}

// The record a param names: { record } when it reads and is fresh, else { why }.
function readRecord(root, file, p, now) {
  if (!file) return { why: 'no record file param: set it to the file the machine holds' };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
  } catch (err) {
    return { why: err?.code === 'ENOENT' ? 'no record file on this machine: the machine that reads the setting saves it' : 'the record file is not valid JSON' };
  }
  const at = Date.parse(doc?.read_at);
  if (!Number.isFinite(at)) return { why: 'the record has no read_at time' };
  if (now - at > p.max_record_days * DAY) return { why: `the record was read more than ${p.max_record_days} days ago: read it again` };
  return { record: doc, at };
}

function gather({ root = '.', params = {}, allParams = {}, now = Date.now(), home = os.homedir() } = {}) {
  void home;
  const p = { ...TEMPLATE, ...allParams['code-project.json'], ...allParams['code-project-tabs.json'], ...params };
  const out = {};
  const stamp = new Date(now).toISOString();
  const cnc = (id, why) => { out[id] = { could_not_check: why, source: DEFINED[id].source }; };
  const val = (id, value, detail, how) => { out[id] = { value, detail, source: `${DEFINED[id].source}; ${how}`, read_at: stamp }; };
  const rows = (rec, key) => (Array.isArray(rec[key]) ? rec[key].filter((r) => r && typeof r === 'object') : []);

  // Settings gaps: a row whose actual value is not the expected one. Values are compared, never kept.
  const settings = readRecord(root, p.settings_file, p, now);
  if (!settings.record) cnc('cp_general.settings_gaps', settings.why);
  else {
    const list = rows(settings.record, 'settings');
    if (!list.length) cnc('cp_general.settings_gaps', 'the settings record holds no row');
    else {
      const gaps = list.filter((r) => JSON.stringify(r.actual) !== JSON.stringify(r.expected)).length;
      val('cp_general.settings_gaps', gaps, [{ label: `of ${list.length} settings`, value: gaps, unit: 'settings' }], `${list.length} settings in the record`);
    }
  }

  // Environment gaps: a needed item the environment does not hold.
  const env = readRecord(root, p.environment_file, p, now);
  if (!env.record) cnc('cp_environment.environment_gaps', env.why);
  else {
    const list = rows(env.record, 'items');
    if (!list.length) cnc('cp_environment.environment_gaps', 'the environment record holds no item');
    else {
      const gaps = list.filter((r) => r.present !== true).length;
      val('cp_environment.environment_gaps', gaps, [{ label: `of ${list.length} items`, value: gaps, unit: 'items' }], `${list.length} items in the record`);
    }
  }

  // Task failures and hours since the last run share one record.
  const tasks = readRecord(root, p.tasks_file, p, now);
  const fail = 'cp_scheduled_tasks.task_failures';
  const since = 'cp_scheduled_tasks.hours_since_last_run';
  if (!tasks.record) {
    cnc(fail, tasks.why);
    cnc(since, tasks.why);
  } else {
    const list = rows(tasks.record, 'tasks');
    if (!list.length) {
      cnc(fail, 'the task record holds no task');
      cnc(since, 'the task record holds no task');
    } else {
      const failed = list.filter((t) => String(t.last_status).toLowerCase() === 'failed').length;
      val(fail, failed, [{ label: `of ${list.length} tasks`, value: failed, unit: 'tasks' }], `${list.length} tasks in the record`);
      const runs = list.map((t) => Date.parse(t.last_run_at)).filter(Number.isFinite);
      if (!runs.length) cnc(since, 'no task in the record has a run time');
      else {
        const hours = Math.max(0, round1((tasks.at - Math.max(...runs)) / HOUR));
        val(since, hours, [{ label: 'since the newest run', value: hours, unit: 'hours' }], `${runs.length} of ${list.length} tasks have a run time`);
      }
    }
  }

  // Largest thread share: one number per thread, no name.
  const id = 'cp_threads.largest_thread_token_share';
  const threads = readRecord(root, p.thread_tokens_file, p, now);
  if (!threads.record) cnc(id, threads.why);
  else {
    const counts = rows(threads.record, 'threads').map((t) => Number(t.tokens)).filter((n) => Number.isFinite(n) && n >= 0);
    const total = counts.reduce((a, b) => a + b, 0);
    if (counts.length < p.min_threads) cnc(id, `the record holds ${counts.length} thread${counts.length === 1 ? '' : 's'}: a share needs at least ${p.min_threads}`);
    else if (total <= 0) cnc(id, 'the threads in the record spent no tokens');
    else {
      const share = round1((100 * Math.max(...counts)) / total);
      val(id, share, [{ label: `largest of ${counts.length} threads`, value: share, unit: '%' }], `${counts.length} threads in the record`);
    }
  }
  return out;
}
