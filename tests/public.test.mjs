// The public configs (quality/public.mjs): every metric that needs local files dropped, every other one as
// written, each map step such a metric scores left out, and the pages' files under quality/public, apart
// from a --local run's.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DROPS, publicProcess, writePublic } from '../quality/public.mjs';
import { localOnlyIds } from './privacy.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// A copy of this repo's config and targets, written to afresh.
function copy() {
  const root = mkdtempSync(join(tmpdir(), 'public-'));
  cpSync(join(ROOT, 'quality', 'config.json'), join(root, 'quality', 'config.json'));
  cpSync(join(ROOT, 'quality', 'public-params.json'), join(root, 'quality', 'public-params.json'));
  cpSync(join(ROOT, 'quality', 'process'), join(root, 'quality', 'process'), { recursive: true });
  for (const dir of ['targets', 'maps', 'ideals']) cpSync(join(ROOT, dir), join(root, dir), { recursive: true });
  return root;
}

test('public: each metric that needs local files is dropped but the repo-file ones, every other one is as written', () => {
  const root = copy();
  const dropped = writePublic(root);
  const pub = read(join(ROOT, 'quality', 'public-params.json'));
  const local = localOnlyIds([join(ROOT, 'targets')]);
  assert.deepEqual(new Set(dropped), new Set([...local].filter((id) => !pub.ids.includes(id))));
  assert.equal(dropped.length, 117);
  const files = readdirSync(join(ROOT, 'targets')).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(readdirSync(join(root, 'quality', 'public', 'targets')).sort(), [...files, DROPS].sort(), 'every targets file, so no collector runs without its targets, and the drops');
  assert.deepEqual(read(join(root, 'quality', 'public', 'targets', DROPS)), [...pub.drop.map((id) => ({ id, drop: true })), ...Object.entries(pub.params_for ?? {}).map(([id, params]) => ({ id, params }))]);
  for (const f of files) {
    const mine = read(join(ROOT, 'targets', f));
    const scoped = mine.some((d) => pub.ids.includes(d.id));
    const want = mine.map((d) => {
      const out = scoped && d.params ? { ...d, params: { ...d.params, ...pub.params } } : d;
      if (pub.ids.includes(d.id)) return { ...out, needs: 'none' };
      return d.needs === 'local-files' ? { ...out, drop: true } : out;
    });
    assert.deepEqual(read(join(root, 'quality', 'public', 'targets', f)), want, f);
  }
  const kept = files.flatMap((f) => read(join(root, 'quality', 'public', 'targets', f))).filter((d) => d.drop !== true).map((d) => d.id);
  const ids = (f) => JSON.parse(readFileSync(join(ROOT, 'targets', f), 'utf8')).map((d) => d.id);
  const [practices, visibility, codeProject] = [ids('practices.json'), ids('visibility.json'), ids('code-project.json').filter((id) => !['code_project.idle_revivals', 'code_project.tokens_per_merged_pr'].includes(id))];
  assert.deepEqual([practices.length, visibility.length, codeProject.length], [10, 5, 15]);
  assert.deepEqual(kept.sort(), ['blockers.enforcement_reverts', 'blockers.pushes_per_merged_pr', 'claude.instruction_tokens', 'claude_settings.deny_coverage', 'claude_settings.setup_files', 'claude_settings.valid', 'cp_pr_auto_fix.fix_attempts', 'cp_pr_auto_fix.red_to_green_minutes', 'cp_pr_auto_fix.skipped_tests', 'cp_threads.attributed_share', 'cp_threads.first_green_minutes', 'instructions.description_tokens', 'lead_time.hours', ...practices, ...visibility, ...codeProject].sort());
});

test('public: the config is the repo own, its targets and the page files under quality/public', () => {
  const root = copy();
  writePublic(root);
  const mine = read(join(ROOT, 'quality', 'config.json'));
  const pub = read(join(root, 'quality', 'public', 'config.json'));
  assert.deepEqual({ ...pub, comment: mine.comment, tabs: mine.tabs }, { ...mine, targets: 'quality/public/targets', ideals: 'quality/public/ideals', data: 'quality/public/data', history: 'quality/public/history', out: 'quality/public/dist' });
  // A tab of the repo's own with no metric left goes, with its ideal; a Git Crafter tab stays (Git Crafter #116).
  const ids = pub.tabs.map((t) => (Array.isArray(t) ? t[0] : t));
  for (const gone of ['desktop-app', 'tokens']) assert.ok(!ids.includes(gone) && !existsSync(join(root, 'quality', 'public', 'ideals', `${gone}.json`)), gone);
  for (const kept of ['claude', 'claude-settings', 'blockers', 'instructions', 'practices', 'visibility', 'code-project', 'dependabot', 'security']) assert.ok(ids.includes(kept), kept);
  assert.ok(existsSync(join(root, 'quality', 'public', 'ideals', 'blockers.json')));
  assert.match(pub.comment, /quality\/public\.mjs/);
});

test('public: a rerun writes afresh, leaving no stale targets file', () => {
  const root = copy();
  writePublic(root);
  writeFileSync(join(root, 'quality', 'public', 'targets', 'stale.json'), '[]');
  writePublic(root);
  assert.ok(!existsSync(join(root, 'quality', 'public', 'targets', 'stale.json')));
});

test('public: the Process config writes each pack map in full, without the steps a dropped metric scores', () => {
  const root = copy();
  const dropped = new Set(writePublic(root));
  const mine = read(join(ROOT, 'quality', 'process', 'config.json'));
  const pub = read(join(root, 'quality', 'public', 'process.json'));
  const PAGE_MAPS = ['context', 'setup-check', 'scheduled-task', 'local-thread', 'pr-flow', 'connectors', 'plugins', 'skills', 'subagents', 'hooks', 'notifications', 'library', 'newer-features', 'kept-off', 'allow-card', 'projects-list'];
  assert.deepEqual(mine.maps, [...['guard', 'decide', 'equip', 'publish', 'visibility', 'project', 'ship', 'environment', 'remember', 'setup', 'memory', 'schedule', ...PAGE_MAPS].map((use) => ({ use }))]);
  assert.deepEqual({ ...pub, comment: mine.comment, maps: mine.maps }, {
    ...mine,
    docs: { maps: 'quality/public/process.json' },
    quality_config: 'quality/public/config.json',
    data: 'quality/public/process/org.json',
    history: null,
    out: 'quality/public/dist',
  });
  // Each pack map in full, less the steps whose metric is dropped; a map with no step left is left out, and its critical path keeps the steps that remain.
  const expected = mine.maps.map(({ use }) => read(join(ROOT, 'maps', `${use}.json`))).flatMap((m) => {
    const steps = m.steps.filter((s) => !dropped.has(s.metric));
    return steps.length ? [{ ...m, critical_path: m.critical_path.filter((c) => steps.some((s) => s.id === c)), steps }] : [];
  });
  assert.deepEqual(pub.maps, expected, 'Decide and Equip score only local-only metrics, so both are left out; Publish, Visibility and Project stay whole; every other map loses only its local-only steps');
  for (const id of ['publish', 'visibility', 'project']) assert.deepEqual(pub.maps.find((m) => m.id === id), read(join(ROOT, 'maps', `${id}.json`)), id);
  for (const s of pub.maps.flatMap((m) => m.steps)) assert.ok(!dropped.has(s.metric), s.metric);
});

test('public: a Process config with no step left names no maps; a library map passes through, a map in full loses its dropped steps', () => {
  const guard = read(join(ROOT, 'maps', 'guard.json'));
  const all = new Set(guard.steps.map((s) => s.metric));
  const none = publicProcess({ docs: { maps: 'x.json' }, maps: [{ use: 'guard' }] }, { guard }, all);
  assert.deepEqual([none.docs.maps, none.maps], [null, []]);
  const own = { id: 'own', name: 'Own', why: 'w', critical_path: ['a', 'b'], steps: [{ id: 'a', metric: 'pr.latest_merge_hours' }, { id: 'b', metric: guard.steps[0].metric }] };
  const kept = { ...own, critical_path: ['a'], steps: [own.steps[0]] };
  assert.deepEqual(publicProcess({ maps: [{ use: 'delivery' }, own] }, { guard }, all).maps, [{ use: 'delivery' }, kept]);
  assert.throws(() => publicProcess({ maps: [{ use: 'guard', name: 'Mine' }] }, { guard }, all), /named by use alone/);
});
