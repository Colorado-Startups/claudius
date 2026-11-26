// The 13 Code Project pages (templates/claude/code-project/page-index.json), their maps and the page kit, held to the
// pack's targets: no page names a metric, tab or map the pack lacks, every Code Project metric belongs to one page,
// and each map the pack ships for a page scores Quality, Speed and Consumption in six steps at most.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
// The Usage tab has metrics but no page yet: its page would need a map of its own.
const NO_PAGE = ['cp-usage'];
const { pages } = read('templates/claude/code-project/page-index.json');
const all = ['code-project-tabs', 'code-project-features'].flatMap((f) => read(`targets/${f}.json`));
const metrics = Object.fromEntries(all.filter((m) => !NO_PAGE.includes(m.tab)).map((m) => [m.id, m]));
const pack = read('pack.json').tabs.map((t) => t[0]).filter((id) => id.startsWith('cp-') && !NO_PAGE.includes(id));
const KINDS = ['quality', 'speed', 'consumption'];
// Two maps that no page names: the Brief and Runtime maps score the readings of several pages.
const EXTRA_MAPS = ['brief', 'runtime'];
const NEW_MAPS = ['context', 'setup-check', 'scheduled-task', 'local-thread', 'pr-flow', 'connectors', 'plugins', 'skills', 'subagents', 'hooks'];

test('pages: thirteen pages with their own ids, each scoring all three kinds', () => {
  assert.equal(pages.length, 13);
  assert.equal(new Set(pages.map((p) => p.id)).size, 13);
  for (const p of pages) for (const k of KINDS) assert.ok(p.metrics[k].length > 0, `${p.id} has no ${k} metric`);
});

test('pages: each page metric exists, has its kind and belongs to a tab of the page', () => {
  for (const p of pages) for (const k of KINDS) for (const id of p.metrics[k]) {
    assert.ok(metrics[id], `${p.id}: ${id} is not a pack metric`);
    assert.equal(metrics[id].kind, k, `${p.id}: ${id}`);
    assert.ok(p.tabs.includes(metrics[id].tab), `${p.id}: ${id} is on ${metrics[id].tab}`);
  }
});

test('pages: every cp tab and every Code Project metric sits on exactly one page', () => {
  const tabs = pages.flatMap((p) => p.tabs);
  assert.deepEqual([...tabs].sort(), [...pack].sort());
  const ids = pages.flatMap((p) => KINDS.flatMap((k) => p.metrics[k]));
  assert.equal(new Set(ids).size, ids.length, 'a metric is on two pages');
  assert.deepEqual([...ids].sort(), Object.keys(metrics).sort());
});

test('pages: each page names a map, and a map of the pack is a file that scores all three kinds in six steps at most', () => {
  for (const p of pages) {
    assert.ok(p.map, p.id);
    if (p.map_from) continue;
    assert.ok(existsSync(`maps/${p.map}.json`), `${p.id}: maps/${p.map}.json`);
    const m = read(`maps/${p.map}.json`);
    assert.equal(m.id, p.map);
    assert.ok(m.steps.length >= 1 && m.steps.length <= 6, `${p.map}: ${m.steps.length} steps`);
  }
  for (const id of NEW_MAPS) {
    const m = read(`maps/${id}.json`);
    assert.deepEqual([...new Set(m.steps.map((s) => metrics[s.metric]?.kind ?? knownKind(s.metric)))].sort(), [...KINDS].sort(), `${id} scores all three kinds`);
    assert.ok(pages.some((p) => p.map === id), `${id} is a page's map`);
  }
});

test('pages: the Brief and Runtime maps score all three kinds, in six steps at most, and draw on the public page', () => {
  for (const id of EXTRA_MAPS) {
    const m = read(`maps/${id}.json`);
    assert.equal(m.id, id);
    assert.ok(m.steps.length >= 1 && m.steps.length <= 6, `${id}: ${m.steps.length} steps`);
    assert.deepEqual([...new Set(m.steps.map((s) => metrics[s.metric]?.kind ?? knownKind(s.metric)))].sort(), [...KINDS].sort(), `${id} scores all three kinds`);
    assert.ok(m.steps.some((s) => (metrics[s.metric] ?? ['code-project'].flatMap((f) => read(`targets/${f}.json`)).find((d) => d.id === s.metric))?.needs !== 'local-files'), `${id} has a step the public page can draw`);
    assert.ok(read('quality/process/config.json').maps.some((x) => x.use === id), `${id} is on the Process page`);
    for (const st of m.steps) assert.ok(st.rule.split(/\s+/).length <= 20, `${id}/${st.id}`);
  }
});

// A step may score a metric outside the Code Project targets (code_project.*, desktop_app.*, practices.*).
function knownKind(id) {
  const all = ['code-project', 'desktop-app', 'practices'].flatMap((f) => read(`targets/${f}.json`)).find((m) => m.id === id);
  return all?.kind;
}

test('pages: the kit has three files that parse, carry placeholders and no em dash', () => {
  for (const f of ['ideal', 'targets', 'map']) {
    const text = readFileSync(`templates/claude/code-project/page/${f}.json`, 'utf8');
    JSON.parse(text);
    assert.match(text, /<[^>]+>/, `${f}.json has placeholders`);
    assert.ok(!text.includes('—'), `${f}.json has an em dash`);
  }
  const readme = readFileSync('templates/claude/code-project/page/README.md', 'utf8');
  assert.ok(!readme.includes('—'));
  assert.match(readme, /page-index\.json/);
});

test('pages: each new map keeps its rules at twenty words and names no private path or account', () => {
  for (const id of NEW_MAPS) {
    const text = readFileSync(`maps/${id}.json`, 'utf8');
    for (const s of JSON.parse(text).steps) assert.ok(s.rule.split(/\s+/).length <= 20, `${id}/${s.id}`);
    assert.doesNotMatch(text, /\/Users\/|\/home\/|@|—/, id);
  }
});
