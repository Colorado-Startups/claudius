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
  assert.equal(dropped.length, 46);
  const files = readdirSync(join(ROOT, 'targets')).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(readdirSync(join(root, 'quality', 'public', 'targets')).sort(), [...files, DROPS].sort(), 'every targets file, so no collector runs without its targets, and the drops');
  assert.deepEqual(read(join(root, 'quality', 'public', 'targets', DROPS)), pub.drop.map((id) => ({ id, drop: true })));
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
  assert.deepEqual(kept.sort(), ['blockers.enforcement_reverts', 'blockers.pushes_per_merged_pr', 'claude.instruction_tokens', 'claude_settings.deny_coverage', 'claude_settings.valid', 'instructions.description_tokens', 'lead_time.hours']);
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
  for (const kept of ['claude', 'claude-settings', 'blockers', 'instructions', 'dependabot', 'security']) assert.ok(ids.includes(kept), kept);
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
  assert.deepEqual(mine.maps, [{ use: 'guard' }, { use: 'decide' }]);
  assert.deepEqual({ ...pub, comment: mine.comment, maps: mine.maps }, {
    ...mine,
    docs: { maps: 'quality/public/process.json' },
    quality_config: 'quality/public/config.json',
    data: 'quality/public/process/org.json',
    history: null,
    out: 'quality/public/dist',
  });
  const guard = read(join(ROOT, 'maps', 'guard.json'));
  assert.deepEqual(pub.maps, [{ ...guard, critical_path: [], steps: guard.steps.filter((s) => s.id === 'change') }], 'Decide scores only local-only metrics, so it is left out');
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
