// node --test collectors/code-projects/code-projects.test.mjs, with the engine's lib (tests/engine-tests.sh).
// Every PR and transcript is synthetic; the transcripts are written to a temp folder at run time.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { CHARTS, loadTargets } from '../lib/engine.mjs';
import { area, collect, metricIds, PARAMS } from './code-projects.mjs';
import { draftFirst, mergedByWeek, openedAsDraft, threadPulls } from './code-projects-pulls.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 864e5;
const iso = (daysAgo, hours = 0) => new Date(NOW - daysAgo * DAY + hours * 36e5).toISOString();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-projects-collector-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

// A PR from a thread: draft true opened as a draft (its first draft event is ready for review).
const pr = (number, { branch = 'claude/thread-x', mergedDaysAgo, draft = true, events }) => ({
  number,
  headRefName: branch,
  createdAt: iso(mergedDaysAgo + 1),
  mergedAt: iso(mergedDaysAgo),
  timelineItems: { nodes: events ?? (draft ? [{ __typename: 'ReadyForReviewEvent', createdAt: iso(mergedDaysAgo + 0.5) }] : []) },
});
const PULLS = [
  pr(1, { mergedDaysAgo: 1 }),
  pr(2, { mergedDaysAgo: 2, draft: false }),
  pr(3, { mergedDaysAgo: 3 }),
  pr(4, { mergedDaysAgo: 4, events: [{ __typename: 'ConvertToDraftEvent', createdAt: iso(4.5) }, { __typename: 'ReadyForReviewEvent', createdAt: iso(4.2) }] }), // opened ready, then draft, then ready
  pr(5, { mergedDaysAgo: 5, branch: 'feature/by-hand', draft: false }), // not a thread's branch
  pr(6, { mergedDaysAgo: 40 }), // older than 30 days
  pr(7, { mergedDaysAgo: 10 }),
  pr(8, { mergedDaysAgo: 17 }),
  pr(9, { mergedDaysAgo: 24 }),
];
const gh = (nodes = PULLS) => ({ graphql: async () => ({ repository: { pullRequests: { nodes } } }) });

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

const result_ = (r, id) => r[`code_projects.${id}`];

test('targets: valid, on the tab, plain means, a goal basis; two need local files and one gh', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-targets-'));
  try {
    fs.copyFileSync(new URL('../../targets/code-projects.json', import.meta.url), path.join(dir, 'code-projects.json'));
    const defs = loadTargets(dir);
    assert.equal(area, 'code_projects');
    assert.deepEqual(defs.map((d) => d.id), metricIds);
    for (const d of defs) {
      assert.equal(d.tab, 'code-projects', d.id);
      assert.ok(d.means && d.means.length <= 120 && !/\d/.test(d.means), `${d.id}: means`);
      assert.ok(CHARTS.has(d.chart), d.id);
      assert.match(d.goal_source, /^(goal from |template goal, no public benchmark: )/, d.id);
      assert.match(d.goal_source, /read 2026-11-25/, d.id);
    }
    assert.deepEqual(Object.fromEntries(defs.map((d) => [d.id, d.needs])), {
      'code_projects.draft_first_share': 'gh',
      'code_projects.idle_revivals': 'local-files',
      'code_projects.tokens_per_merged_pr': 'local-files',
    });
    assert.deepEqual(Object.fromEntries(defs.map((d) => [d.id, d.kind])), {
      'code_projects.draft_first_share': 'quality',
      'code_projects.idle_revivals': 'consumption',
      'code_projects.tokens_per_merged_pr': 'consumption',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pulls: a PR opened as a draft has ready-for-review as its first draft event', () => {
  assert.equal(openedAsDraft(PULLS[0]), true);
  assert.equal(openedAsDraft(PULLS[1]), false);
  assert.equal(openedAsDraft(PULLS[3]), false, 'converted to draft after opening');
  const mine = threadPulls(PULLS, { prefix: 'claude/', now: NOW, days: 30 });
  assert.deepEqual(mine.map((p) => p.number), [1, 2, 3, 4, 7, 8, 9]);
  assert.deepEqual(draftFirst(mine), { share: 71.4, drafts: 5, total: 7 });
  assert.equal(draftFirst([]), null);
  assert.deepEqual(mergedByWeek(threadPulls(PULLS, { prefix: 'claude/', now: NOW }), { now: NOW, weeks: 4 }), [1, 1, 1, 4]);
});

test('CI: the draft share is read, the two local metrics are named not measured, never 0', async () => {
  const r = await collect({ root: tmp, mode: 'ci', params: { ...PARAMS, repo: 'acme/site' }, gh: gh(), now: new Date(NOW), home });
  assert.deepEqual(Object.keys(r), metricIds);
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
  const broken = await collect({ ...base, params: { ...PARAMS, repo: 'acme/site', project_match: 'acme-site' }, gh: { graphql: async () => { throw new Error('boom\nsecret'); } } });
  assert.match(result_(broken, 'draft_first_share').could_not_check, /^gh api graphql failed: boom$/);
  assert.equal(result_(broken, 'idle_revivals').value, 1);
  assert.match(result_(broken, 'tokens_per_merged_pr').could_not_check, /gh api graphql failed/);
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
