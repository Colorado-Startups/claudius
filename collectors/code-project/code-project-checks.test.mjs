// node --import ./tests/engine-lib.mjs --test collectors/code-project/code-project-checks.test.mjs
// Every input is synthetic: a fake gh client that answers the REST routes the collector reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { area, checkState, collect, metricIds, skipsATest } from './code-project-checks.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const ATTR = '<!-- claude-projects-attribution: {"github_login":"x"} -->\n_Requested by_';
const run = (conclusion, done) => ({ status: 'completed', conclusion, completed_at: done });

// One thread PR: opened 10:00, commit a goes red at 10:20, commit b (the fix) is green at 10:50.
function fake({ body = ATTR, fixPatch = '+  expect(x).toBe(1);', second = true } = {}) {
  const pulls = [
    { number: 1, head: { ref: 'claude/a' }, created_at: '2026-11-24T10:00:00Z', merged_at: '2026-11-24T12:00:00Z', body },
    { number: 2, head: { ref: 'feat/b' }, created_at: '2026-11-24T10:00:00Z', merged_at: '2026-11-24T12:00:00Z', body: 'x' },
  ];
  return {
    rest: async (route) => {
      if (route.startsWith('repos/acme/app/pulls?')) return pulls;
      if (route.startsWith('repos/acme/app/pulls/1/commits')) return second ? [{ sha: 'aaaaaaa1' }, { sha: 'bbbbbbb2' }] : [{ sha: 'aaaaaaa1' }];
      if (route.startsWith('repos/acme/app/commits/aaaaaaa1/check-runs')) return { check_runs: [run('failure', '2026-11-24T10:20:00Z'), run('success', '2026-11-24T10:15:00Z')] };
      if (route.startsWith('repos/acme/app/commits/bbbbbbb2/check-runs')) return { check_runs: [run('success', '2026-11-24T10:50:00Z')] };
      if (route === 'repos/acme/app/commits/bbbbbbb2') return { files: [{ filename: 'src/a.test.js', status: 'modified', patch: fixPatch }] };
      throw Object.assign(new Error(`HTTP 404: ${route}`), { status: 404 });
    },
  };
}
const go = (gh, params = {}) => collect({ root: '.', params: { repo: 'acme/app', branch_prefix: 'claude/', window_days: 30, max_prs: 10, ...params }, gh, now: NOW });

test('cp-pulls: every id, from one red then green thread', async () => {
  assert.equal(area, 'cp-pulls');
  const out = await go(fake());
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  assert.equal(out['cp_threads.attributed_share'].value, 100, 'the feat/ pull request is not a thread');
  assert.equal(out['cp_threads.first_green_minutes'].value, 50, 'opened 10:00, first green 10:50');
  assert.equal(out['cp_pr_auto_fix.red_to_green_minutes'].value, 30, 'red 10:20, green 10:50');
  assert.equal(out['cp_pr_auto_fix.fix_attempts'].value, 1);
  assert.equal(out['cp_pr_auto_fix.skipped_tests'].value, 0);
});

test('cp-pulls: a fix that skips a test is counted and named', async () => {
  const out = await go(fake({ fixPatch: "+  it.skip('flaky', () => {});" }));
  assert.equal(out['cp_pr_auto_fix.skipped_tests'].value, 1);
  assert.deepEqual(out['cp_pr_auto_fix.skipped_tests'].detail, [{ label: '#1 bbbbbbb', value: 1, unit: 'commits' }]);
});

test('cp-pulls: no attribution line is 0 share, and a pull request left red is not an attempt count', async () => {
  const gh = fake({ body: 'plain body', second: false });
  const out = await go(gh);
  assert.equal(out['cp_threads.attributed_share'].value, 0);
  assert.equal(out['cp_pr_auto_fix.red_to_green_minutes'].could_not_check, 'no pull request went red and then green');
});

test('cp-pulls: nothing merged is not measured, never 0', async () => {
  const out = await go({ rest: async () => [] });
  for (const id of metricIds) assert.match(out[id].could_not_check, /no claude\/ pull request merged/);
});

test('cp-pulls: a failing API is not measured with the reason', async () => {
  const out = await go({ rest: async () => { throw new Error('HTTP 403: rate limit'); } });
  for (const id of metricIds) assert.match(out[id].could_not_check, /403/);
});

test('cp-pulls: a cancelled run is a superseded push, not a red commit', async () => {
  const gh = fake();
  const rest = gh.rest;
  gh.rest = async (route) => (route.startsWith('repos/acme/app/commits/aaaaaaa1/check-runs') ? { check_runs: [run('cancelled', '2026-11-24T10:20:00Z')] } : rest(route));
  const out = await go(gh);
  assert.equal(out['cp_pr_auto_fix.fix_attempts'].value, 0, 'no red commit, so no attempt');
  assert.equal(out['cp_threads.first_green_minutes'].value, 50);
});

test('cp-pulls: a pull request past max_commits adds no attempt count', async () => {
  const gh = fake();
  const rest = gh.rest;
  gh.rest = async (route) => (route.startsWith('repos/acme/app/pulls/1/commits') ? [{ sha: 'aaaaaaa1' }, { sha: 'bbbbbbb2' }, { sha: 'ccccccc3' }] : rest(route));
  const out = await go(gh, { max_commits: 2 });
  assert.equal(out['cp_threads.first_green_minutes'].value, 50, 'still read for its first green');
  assert.match(out['cp_pr_auto_fix.fix_attempts'].could_not_check, /none stayed green|no pull request/);
  assert.equal(out['cp_pr_auto_fix.red_to_green_minutes'].could_not_check, 'no pull request went red and then green');
});

test('checkState and skipsATest', () => {
  assert.equal(checkState([run('success', '2026-11-24T10:00:00Z'), { status: 'in_progress' }]).state, 'pending');
  assert.equal(checkState([]).state, 'pending');
  assert.equal(skipsATest([{ filename: 'tests/x.py', status: 'removed' }]), true);
  assert.equal(skipsATest([{ filename: 'src/x.py', status: 'removed' }]), false);
  assert.equal(skipsATest([{ filename: 'a.py', status: 'modified', patch: '+@pytest.mark.skip' }]), true);
});
