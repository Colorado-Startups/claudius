// node --import ./tests/engine-lib.mjs --test collectors/code-project/code-project-threads.test.mjs
// Every PR and transcript is synthetic; the transcripts are written to a temp folder at run time.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { CHARTS, loadTargets } from '../lib/engine.mjs';
import { area, collect, metricIds } from './code-project.mjs';
import { draftFirst, mergedByWeek, openedAsDraft, readMerged, threadPulls, withDraftState } from './code-project-pulls.mjs';

const THREAD_IDS = ['code_project.draft_first_share', 'code_project.idle_revivals', 'code_project.tokens_per_merged_pr'];
const PARAMS = Object.assign({}, ...JSON.parse(fs.readFileSync(new URL('../../targets/code-project.json', import.meta.url), 'utf8')).map((t) => t.params ?? {}));
const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 864e5;
const iso = (daysAgo, hours = 0) => new Date(NOW - daysAgo * DAY + hours * 36e5).toISOString();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-project-threads-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

// A PR from a thread, as repos/<repo>/pulls returns it, with the issue events repos/<repo>/issues/<n>/events returns:
// draft true opened as a draft (its first draft event is ready_for_review).
const pr = (number, { branch = 'claude/thread-x', mergedDaysAgo, draft = true, events }) => ({
  number,
  head: { ref: branch },
  created_at: iso(mergedDaysAgo + 1),
  merged_at: iso(mergedDaysAgo),
  events: events ?? [{ event: 'labeled', created_at: iso(mergedDaysAgo + 0.9) }, ...(draft ? [{ event: 'ready_for_review', created_at: iso(mergedDaysAgo + 0.5) }] : [])],
});
const PULLS = [
  pr(1, { mergedDaysAgo: 1 }),
  pr(2, { mergedDaysAgo: 2, draft: false }),
  pr(3, { mergedDaysAgo: 3 }),
  pr(4, { mergedDaysAgo: 4, events: [{ event: 'ready_for_review', created_at: iso(4.2) }, { event: 'convert_to_draft', created_at: iso(4.5) }].reverse() }), // opened ready, then draft, then ready
  pr(5, { mergedDaysAgo: 5, branch: 'feature/by-hand', draft: false }), // not a thread's branch
  pr(6, { mergedDaysAgo: 40 }), // older than 30 days
  pr(7, { mergedDaysAgo: 10 }),
  pr(8, { mergedDaysAgo: 17 }),
  pr(9, { mergedDaysAgo: 24 }),
  { ...pr(10, { mergedDaysAgo: 30 }), merged_at: null }, // closed, never merged
];
// A fake gh client: REST only, the way a cloud thread reads it. GraphQL is refused, as it is there.
const gh = (list = PULLS) => ({
  rest: async (route) => {
    if (/^repos\/acme\/site\/pulls\?/.test(route)) return list.map(({ events, ...rest }) => rest);
    const m = /^repos\/acme\/site\/issues\/(\d+)\/events\?/.exec(route);
    const one = m && list.find((p) => p.number === Number(m[1]));
    if (one) return one.events;
    throw Object.assign(new Error(`HTTP 404: ${route}`), { status: 404 });
  },
  graphql: async () => {
    throw new Error('GitHub GraphQL is not available from Claude Code sessions');
  },
});
const merged = (list = PULLS) => readMerged(gh(list), 'acme/site');

// Transcripts: one main session s1 with a subagent, in a folder naming the project.
const home = path.join(tmp, 'home');
const projects = path.join(home, '.claude', 'projects');
const folder = path.join(projects, '-work-acme-site');
const rec = (sid, daysAgo, hours, rest) => ({ timestamp: iso(daysAgo, hours), sessionId: sid, ...rest });
const typed = (sid, daysAgo, hours) => rec(sid, daysAgo, hours, { type: 'user', origin: { kind: 'human' }, message: { content: 'secret prompt text' } });
const reply = (sid, daysAgo, hours, id, usage) => rec(sid, daysAgo, hours, { type: 'assistant', message: { id, usage, content: [{ type: 'text', text: 'secret reply' }] } });
const result = (sid, daysAgo, hours) => rec(sid, daysAgo, hours, { type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } });
const use = (input, output, cacheWrite) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: 999999 });

function write(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, jsonl(rows));
  fs.utimesSync(file, NOW / 1000, NOW / 1000);
}
// s1 (days ago, hours): typed at 0.5 d ago; resumed 3 h later (revival); then 30 min on (no); a tool result after 2 h (no, not typed);
// an old revival 20 days ago (outside the week). Tokens per week: oldest 3 weeks have replies to match the PRs.
write(path.join(folder, 's1.jsonl'), [
  typed('s1', 20, 0), reply('s1', 20, 0.1, 'm-old', use(1, 1, 1)), typed('s1', 20, 5), // an old revival
  typed('s1', 3, 0), reply('s1', 3, 0.1, 'm1', use(100, 200, 700)),
  typed('s1', 3, -3), // 3 hours later: a revival in the last week
  reply('s1', 3, -3.1, 'm2', use(10, 20, 70)),
  typed('s1', 3, -3.5), // 30 minutes later: not one
  result('s1', 3, -5.6), // 2 hours later but no person typed: not one
  reply('s1', 3, -5.7, 'm2', use(10, 20, 70)), // a copy of m2: counted once
]);
write(path.join(folder, 's1', 'subagents', 'agent-1.jsonl'), [reply('s1', 3, -1, 'sub1', use(0, 100, 0))]);
// Per week, oldest first: week 1 (days 21-28 ago) and week 2 (14-21) and week 3 (7-14) and week 4 (0-7).
write(path.join(folder, 's2.jsonl'), [
  reply('s2', 24, 0, 'w1', use(0, 0, 4000)), // week 1: PR 9 merged 24 d ago
  reply('s2', 17, 0, 'w2', use(0, 0, 3000)), // week 2: PR 8
  reply('s2', 10, 0, 'w3', use(0, 0, 2000)), // week 3: PR 7
]);

const result_ = (r, id) => r[`code_project.${id}`];

test('targets: valid, on the tab, plain means, a goal basis; two need local files and one gh', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-targets-'));
  try {
    fs.copyFileSync(new URL('../../targets/code-project.json', import.meta.url), path.join(dir, 'code-project.json'));
    let defs = loadTargets(dir);
    assert.equal(area, 'code-project');
    assert.deepEqual(defs.map((d) => d.id), metricIds);
    defs = defs.filter((d) => THREAD_IDS.includes(d.id));
    for (const d of defs) {
      assert.equal(d.tab, 'code-project', d.id);
      assert.ok(d.means && d.means.length <= 120 && !/\d/.test(d.means), `${d.id}: means`);
      assert.ok(CHARTS.has(d.chart), d.id);
      assert.match(d.goal_source, /^(goal from |template goal, no public benchmark: )/, d.id);
      assert.match(d.goal_source, /read 2026-11-25/, d.id);
    }
    assert.deepEqual(Object.fromEntries(defs.map((d) => [d.id, d.needs])), {
      'code_project.draft_first_share': 'gh',
      'code_project.idle_revivals': 'local-files',
      'code_project.tokens_per_merged_pr': 'local-files',
    });
    assert.deepEqual(Object.fromEntries(defs.map((d) => [d.id, d.kind])), {
      'code_project.draft_first_share': 'quality',
      'code_project.idle_revivals': 'consumption',
      'code_project.tokens_per_merged_pr': 'consumption',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pulls: a PR opened as a draft has ready_for_review as its first draft event', async () => {
  assert.equal(openedAsDraft(PULLS[0].events), true);
  assert.equal(openedAsDraft(PULLS[1].events), false);
  assert.equal(openedAsDraft(PULLS[3].events), false, 'converted to draft after opening');
  assert.equal(openedAsDraft(undefined), false);
  const all = await merged();
  assert.deepEqual(all.map((p) => p.number), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'a PR closed unmerged is left out');
  const mine = threadPulls(all, { prefix: 'claude/', now: NOW, days: 30 });
  assert.deepEqual(mine.map((p) => p.number), [1, 2, 3, 4, 7, 8, 9]);
  assert.deepEqual(draftFirst(await withDraftState(gh(), 'acme/site', mine)), { share: 71.4, drafts: 5, total: 7 });
  assert.equal(draftFirst([]), null);
  assert.deepEqual(mergedByWeek(threadPulls(all, { prefix: 'claude/', now: NOW }), { now: NOW, weeks: 4 }), [1, 1, 1, 4]);
});

test('CI: the draft share is read, the two local metrics are named not measured, never 0', async () => {
  const reads = [];
  const client = gh();
  const counted = { ...client, rest: async (route) => (reads.push(route), client.rest(route)) };
  const r = await collect({ root: tmp, mode: 'ci', params: { ...PARAMS, repo: 'acme/site' }, gh: counted, now: new Date(NOW), home });
  assert.equal(reads.filter((route) => route.includes('/issues/')).length, 7, 'one events read for each thread PR of the window, and no GraphQL');
  assert.deepEqual(Object.keys(r).sort(), [...metricIds].sort());
  assert.equal(result_(r, 'draft_first_share').value, 71.4);
  assert.deepEqual(result_(r, 'draft_first_share').detail.map((d) => d.value), [5, 2]);
  for (const id of ['idle_revivals', 'tokens_per_merged_pr']) assert.match(result_(r, id).could_not_check, /transcripts live on the machine/);
});

test('local: one revival in the last week, and the 4-week change in tokens per merged PR', async () => {
  const r = await collect({ root: path.join(tmp, 'acme-site'), mode: 'local', params: { ...PARAMS, repo: 'acme/site', project_match: 'acme-site' }, gh: gh(), now: new Date(NOW), home });
  assert.equal(result_(r, 'idle_revivals').value, 1, 'only the typed record after 3 idle hours, in the last 7 days');
  // Tokens per PR, oldest week first: 4000 / 1, 3000 + 3 (m-old) / 1, 2000 / 1, the latest week 1000 (m1) + 100 (m2) + 100 (sub1) = 1200 over 4 PRs = 300.
  const t = result_(r, 'tokens_per_merged_pr');
  assert.deepEqual(t.detail.map((d) => d.value), [4000, 3003, 2000, 300]);
  assert.equal(t.value, -92.5, '300 / 4000 - 1');
});

test('local: a trend needs two weeks with both; a missing folder or PR read says so', async () => {
  const base = { root: path.join(tmp, 'acme-site'), mode: 'local', now: new Date(NOW), home };
  const few = await collect({ ...base, params: { ...PARAMS, repo: 'acme/site', project_match: 'acme-site' }, gh: gh([PULLS[0]]) });
  assert.match(result_(few, 'tokens_per_merged_pr').could_not_check, /fewer than two/);
  assert.equal(result_(few, 'idle_revivals').value, 1);
  const none = await collect({ ...base, params: { ...PARAMS, repo: 'acme/site', project_match: 'nosuch-folder' }, gh: gh() });
  assert.match(result_(none, 'idle_revivals').could_not_check, /no session transcript/);
  const stale = path.join(projects, '-work-stale-site', 's9.jsonl');
  write(stale, [typed('s9', 60, 0), typed('s9', 60, -3)]);
  fs.utimesSync(stale, (NOW - 60 * 86400000) / 1000, (NOW - 60 * 86400000) / 1000);
  const old = await collect({ ...base, params: { ...PARAMS, repo: 'acme/site', project_match: 'stale-site' }, gh: gh() });
  assert.match(result_(old, 'idle_revivals').could_not_check, /no session transcript/, 'only old transcripts is not 0');
  assert.match(result_(old, 'tokens_per_merged_pr').could_not_check, /no session transcript written in the last 4 weeks/, '60 days is outside the 4 weeks too');
  const mid = path.join(projects, '-work-mid-site', 's8.jsonl');
  write(mid, [typed('s8', 10, 0), reply('s8', 10, 0.1, 'mid1', use(10, 10, 10))]);
  fs.utimesSync(mid, (NOW - 10 * 86400000) / 1000, (NOW - 10 * 86400000) / 1000);
  const middle = await collect({ ...base, params: { ...PARAMS, repo: 'acme/site', project_match: 'mid-site' }, gh: gh() });
  assert.match(result_(middle, 'idle_revivals').could_not_check, /no session transcript written in the last 7 days/);
  assert.doesNotMatch(result_(middle, 'tokens_per_merged_pr').could_not_check ?? '', /no session transcript/, 'a 10-day-old transcript still feeds the 4-week trend');
  const broken = await collect({ ...base, params: { ...PARAMS, repo: 'acme/site', project_match: 'acme-site' }, gh: { rest: async () => { throw new Error('boom\nsecret'); } } });
  assert.match(result_(broken, 'draft_first_share').could_not_check, /^gh api failed: boom$/);
  assert.equal(result_(broken, 'idle_revivals').value, 1);
  assert.match(result_(broken, 'tokens_per_merged_pr').could_not_check, /gh api failed/);
  const bare = await collect({ ...base, params: { ...PARAMS, repo: 'acme/site', project_match: '/' }, gh: gh() });
  assert.match(result_(bare, 'idle_revivals').could_not_check, /would read every project folder/);
});

test('local: no PR from a thread branch is not 0', async () => {
  const r = await collect({ root: tmp, mode: 'ci', params: { ...PARAMS, repo: 'acme/site' }, gh: gh([PULLS[4]]), now: new Date(NOW), home });
  assert.match(result_(r, 'draft_first_share').could_not_check, /no PR from a claude\/ branch/);
});

test('privacy: the output holds counts only, never a prompt, a reply, a home path or a session id', async () => {
  const r = await collect({ root: path.join(tmp, 'acme-site'), mode: 'local', params: { ...PARAMS, repo: 'acme/site', project_match: 'acme-site' }, gh: gh(), now: new Date(NOW), home });
  const text = JSON.stringify(r);
  for (const leak of ['secret', 's1', 's2', home, tmp]) assert.ok(!text.includes(leak), leak);
});
