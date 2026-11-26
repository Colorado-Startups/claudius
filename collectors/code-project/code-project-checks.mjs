// The Code Project pages' five pull request metrics, read from GitHub alone (REST, so a cloud thread can run it):
//   cp_threads.attributed_share, cp_threads.first_green_minutes,
//   cp_pr_auto_fix.red_to_green_minutes, cp_pr_auto_fix.fix_attempts, cp_pr_auto_fix.skipped_tests.
// A thread's pull request is a merged one from a claude/ branch (the params of targets/code-project.json). Each of
// its commits is read once for its check runs. A commit is red when a finished check run failed or timed out (a cancelled
// run is a superseded push, not a failure), and green when it has finished check runs and every one passed. A fix push is a commit after the first
// red one, up to and including the next green one. GitHub does not say who pushed a fix, so a push by a person
// counts the same as an auto fix. A metric with nothing to read is not measured, never 0 (Git Crafter quality/SCORING.md).
import fs from 'node:fs';
import { ghClient, ownRepo, percentile, redact, useLib } from '../lib/engine.mjs';

export const area = 'cp-pulls';
// Reads the GitHub API: collect.mjs skips it under the API reserve (ci.json params.api_reserve).
export const githubApi = true;
export const metricIds = ['cp_threads.attributed_share', 'cp_threads.first_green_minutes', 'cp_pr_auto_fix.red_to_green_minutes', 'cp_pr_auto_fix.fix_attempts', 'cp_pr_auto_fix.skipped_tests'];

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/code-project.json', import.meta.url), 'utf8'));
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const DEFINED = Object.fromEntries(
  ['code-project-tabs.json', 'code-project-features.json'].flatMap((f) => JSON.parse(fs.readFileSync(new URL(`../../targets/${f}`, import.meta.url), 'utf8'))).map((t) => [t.id, t]),
);

const ATTRIBUTION = /^\s*<!--\s*claude-projects-attribution\b/;
const FAILED = new Set(['failure', 'timed_out', 'action_required']);
const PASSED = new Set(['success', 'neutral', 'skipped']);
// A line a fix adds to skip, disable or park a test, and the paths of a test file whose removal is a skip too.
const SKIP_LINE = /^\+.*(\.skip\s*\(|\bx(it|describe|test)\s*\(|\.todo\s*\(|@pytest\.mark\.skip|@unittest\.skip|\bt\.Skip\s*\(|#\[ignore\])/;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go)$|(^|\/)test_[^/]*\.py$/;

const median = (list) => (list.length ? Math.round(percentile(list, 0.5) * 10) / 10 : null);
const mean = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);
const firstLine = (err) => String(err?.message || err).trim().split('\n')[0].slice(0, 160);

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(await gather(opts), opts.home);
}

// A commit's check state from its check runs: { state: 'red' | 'green' | 'pending', at } where at is the ms the
// state was reached (the first failure, or the last finish).
export function checkState(runs) {
  const done = runs.filter((r) => r.status === 'completed' && Number.isFinite(Date.parse(r.completed_at)));
  const failed = done.filter((r) => FAILED.has(r.conclusion));
  if (failed.length) return { state: 'red', at: Math.min(...failed.map((r) => Date.parse(r.completed_at))) };
  if (done.length && done.length === runs.length && done.every((r) => PASSED.has(r.conclusion))) return { state: 'green', at: Math.max(...done.map((r) => Date.parse(r.completed_at))) };
  return { state: 'pending', at: null };
}

// Whether a commit's files skip, disable or delete a test.
export function skipsATest(files) {
  return files.some((f) => (f.status === 'removed' && TEST_PATH.test(f.filename)) || String(f.patch ?? '').split('\n').some((l) => SKIP_LINE.test(l)));
}

async function gather({ root = '.', params = {}, allParams = {}, gh, now = Date.now() } = {}) {
  const readAt = new Date(now).toISOString();
  const out = {};
  const pull = { ...TEMPLATE, ...allParams['code-project.json'], ...params };
  const maxCommits = pull.max_commits ?? 10;
  const sourceOf = (id) => DEFINED[id]?.source ?? 'gh api repos';
  const val = (id, value, note, detail) => (out[id] = { value, ...(detail?.length ? { detail } : {}), source: `${sourceOf(id)}; ${note}`, read_at: readAt });
  const cnc = (id, reason) => (out[id] = { could_not_check: reason, source: sourceOf(id) });
  try {
    const repo = pull.repo || (await ownRepo(root, {}));
    if (!repo) throw new Error('no repo to read: set params.repo on quality/targets/code-project.json');
    const client = gh ?? ghClient();
    const since = now - pull.window_days * 86400000;
    const listed = await client.rest(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
    const pulls = listed.filter((p) => p.merged_at && Date.parse(p.merged_at) >= since && String(p.head?.ref ?? '').startsWith(pull.branch_prefix)).slice(0, pull.max_prs);
    const window = `merged claude/ pull requests of the last ${pull.window_days} days (${pulls.length} read, at most ${pull.max_prs})`;
    if (!pulls.length) {
      for (const id of metricIds) cnc(id, `no ${pull.branch_prefix} pull request merged in ${pull.window_days} days`);
      return out;
    }
    val('cp_threads.attributed_share', Math.round((1000 * pulls.filter((p) => ATTRIBUTION.test(p.body ?? '')).length) / pulls.length) / 10, window);

    const green = [], redToGreen = [], attempts = [], skipped = [];
    for (const p of pulls) {
      const all = await client.rest(`repos/${repo}/pulls/${p.number}/commits?per_page=100`);
      // A pull request with more commits than max_commits is read for its first green only: a red or a fix past the
      // last commit read would be missed, so it adds no attempt count, a recovery time or a skipped test.
      const truncated = all.length > maxCommits;
      const commits = all.slice(0, maxCommits);
      const states = [];
      for (const c of commits) {
        const runs = (await client.rest(`repos/${repo}/commits/${c.sha}/check-runs?per_page=100`))?.check_runs ?? [];
        states.push({ sha: c.sha, ...checkState(runs) });
      }
      const firstGreen = states.find((s) => s.state === 'green');
      if (firstGreen) green.push(Math.max(0, (firstGreen.at - Date.parse(p.created_at)) / 60000));
      if (truncated) continue;
      const red = states.findIndex((s) => s.state === 'red');
      const back = red < 0 ? -1 : states.findIndex((s, i) => i > red && s.state === 'green');
      if (red < 0) attempts.push(0);
      else if (back > red) {
        redToGreen.push((states[back].at - states[red].at) / 60000);
        attempts.push(back - red);
        for (const s of states.slice(red + 1, back + 1)) {
          const files = (await client.rest(`repos/${repo}/commits/${s.sha}`))?.files ?? [];
          if (skipsATest(files)) skipped.push({ label: `#${p.number} ${s.sha.slice(0, 7)}`, value: 1, unit: 'commits' });
        }
      }
    }
    if (green.length) val('cp_threads.first_green_minutes', median(green), `${window}; median of ${green.length}, minutes from the pull request opening to its first green commit`);
    else cnc('cp_threads.first_green_minutes', 'no pull request had a commit whose check runs all passed');
    if (redToGreen.length) val('cp_pr_auto_fix.red_to_green_minutes', median(redToGreen), `${window}; median of ${redToGreen.length} red-to-green recoveries`);
    else cnc('cp_pr_auto_fix.red_to_green_minutes', 'no pull request went red and then green');
    if (attempts.length) val('cp_pr_auto_fix.fix_attempts', mean(attempts), `${window}; mean of ${attempts.length} pull requests, 0 for one that never went red`);
    else cnc('cp_pr_auto_fix.fix_attempts', 'no pull request finished green after a red commit and none stayed green');
    if (redToGreen.length) val('cp_pr_auto_fix.skipped_tests', skipped.length, `${window}; fix pushes read: ${redToGreen.length}`, skipped);
    else cnc('cp_pr_auto_fix.skipped_tests', 'no fix pushes to read');
  } catch (err) {
    for (const id of metricIds) if (!out[id]) cnc(id, firstLine(err));
  }
  return Object.fromEntries(metricIds.map((id) => [id, out[id] ?? { could_not_check: 'collector produced no value', source: sourceOf(id) }]));
}
