// The public config (quality/public.mjs): every metric that needs local files dropped, every other one as
// written, and the page's files under quality/public, apart from a --local run's.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { writePublic } from '../quality/public.mjs';
import { localOnlyIds } from './privacy.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// A copy of this repo's config and targets, written to afresh.
function copy() {
  const root = mkdtempSync(join(tmpdir(), 'public-'));
  cpSync(join(ROOT, 'quality', 'config.json'), join(root, 'quality', 'config.json'));
  cpSync(join(ROOT, 'targets'), join(root, 'targets'), { recursive: true });
  return root;
}

test('public: each metric that needs local files is dropped, every other one is as written', () => {
  const root = copy();
  const dropped = writePublic(root);
  assert.deepEqual(new Set(dropped), localOnlyIds([join(ROOT, 'targets')]));
  assert.equal(dropped.length, 47);
  const files = readdirSync(join(ROOT, 'targets')).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(readdirSync(join(root, 'quality', 'public', 'targets')).sort(), files, 'every targets file, so no collector runs without its targets');
  for (const f of files) {
    const mine = read(join(ROOT, 'targets', f));
    const pub = read(join(root, 'quality', 'public', 'targets', f));
    assert.deepEqual(pub, mine.map((d) => (d.needs === 'local-files' ? { ...d, drop: true } : d)), f);
  }
  const kept = files.flatMap((f) => read(join(root, 'quality', 'public', 'targets', f))).filter((d) => d.drop !== true).map((d) => d.id);
  assert.deepEqual(kept.sort(), ['blockers.enforcement_reverts', 'blockers.pushes_per_merged_pr', 'claude_settings.valid', 'lead_time.hours']);
});

test('public: the config is the repo own, its targets and the page files under quality/public', () => {
  const root = copy();
  writePublic(root);
  const mine = read(join(ROOT, 'quality', 'config.json'));
  const pub = read(join(root, 'quality', 'public', 'config.json'));
  assert.deepEqual({ ...pub, comment: mine.comment }, { ...mine, targets: 'quality/public/targets', data: 'quality/public/data', history: 'quality/public/history', out: 'quality/public/dist' });
  assert.match(pub.comment, /quality\/public\.mjs/);
});

test('public: a rerun writes afresh, leaving no stale targets file', () => {
  const root = copy();
  writePublic(root);
  writeFileSync(join(root, 'quality', 'public', 'targets', 'stale.json'), '[]');
  writePublic(root);
  assert.ok(!existsSync(join(root, 'quality', 'public', 'targets', 'stale.json')));
});
