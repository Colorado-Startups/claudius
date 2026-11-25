// node --test tests/plugin.test.mjs
// The Claudius plugin in plugin/: the directory's file rules (claude.com/docs/plugins/pre-submission-checklist,
// read 2026-11-15) and a budget on what it adds to every session.

import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../plugin/', import.meta.url));
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return lstatSync(p).isDirectory() ? walk(p) : [p];
});
const frontmatter = (file) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, 'utf8'));
  return m ? Object.fromEntries(m[1].split('\n').map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2]])) : null;
};
const skills = readdirSync(join(ROOT, 'skills'));

test('plugin: manifest, README of 40+ words, and a license, as the directory requires', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.match(manifest.name, /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);
  for (const k of ['description', 'author', 'version', 'license']) assert.ok(manifest[k], k);
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/```[\s\S]*?```/g, '');
  assert.ok(words(readme) >= 40);
  assert.ok(existsSync(join(ROOT, 'LICENSE')));
});

// The two guard hooks are the only scripts it ships (tests/guard-hooks.test.mjs holds what they may never do). Hooks are one of the
// directory's review triggers: a listing of this plugin upstream waits for the maintainer's decision on that.
test('plugin: nothing that gets held for review but the two guard hooks: no MCP servers, bin, symlinks, system files, or non-image files over 256 KiB', () => {
  for (const p of ['.mcp.json', 'bin']) assert.ok(!existsSync(join(ROOT, p)), p);
  assert.deepEqual(readdirSync(join(ROOT, 'hooks')).sort(), ['deny.mjs', 'guard-deny-list.mjs', 'guard-public-write.mjs', 'hooks.json']);
  const files = walk(ROOT);
  assert.ok(files.length <= 512);
  for (const f of files) {
    assert.ok(!lstatSync(f).isSymbolicLink(), f);
    assert.ok(!/(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(f), f);
    // The 256 KiB rule is for files that aren't images or fonts; every file stays under 5 MiB (pre-submission checklist, read 2026-11-15).
    const image = /\.(png|jpe?g|gif|webp)$/i.test(f);
    assert.ok(lstatSync(f).size < (image ? 5 * 1024 * 1024 : 256 * 1024), f);
  }
});

test('plugin: each skill has a name and a description of at most 50 words; the listing stays under 500 tokens', () => {
  let chars = 0;
  for (const s of skills) {
    const fm = frontmatter(join(ROOT, 'skills', s, 'SKILL.md'));
    assert.ok(fm, s);
    assert.equal(fm.name, s);
    assert.ok(words(fm.description) <= 50, `${s}: ${words(fm.description)} words`);
    chars += fm.name.length + fm.description.length;
  }
  // claude plugin details reports ~404 always-on tokens for these six at 0.4.1 (2026-11-19); characters / 4 is the budget's estimate.
  assert.ok(chars / 4 < 500, `${Math.round(chars / 4)} tokens`);
});

test('plugin: the directory listing fields point at files that exist, and each skill names what it needs', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(existsSync(join(ROOT, manifest.icon)), 'icon');
  for (const k of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) assert.match(manifest[k], /^https:\/\//, k);
  for (const s of skills) {
    const file = join(ROOT, 'skills', s, 'SKILL.md');
    const fm = frontmatter(file);
    assert.ok(fm.compatibility && fm.compatibility.length <= 500, `${s}: compatibility`);
    assert.ok(/^Requires /m.test(readFileSync(file, 'utf8')), `${s}: a line starting Requires`);
    const cases = readdirSync(join(ROOT, 'evals')).filter((c) => existsSync(join(ROOT, 'evals', c, 'prompt.md')) && readFileSync(join(ROOT, 'evals', c, 'graders', 'skill-fired.md'), 'utf8').includes(`?${s}"`));
    assert.ok(cases.length >= 3, `${s}: ${cases.length} evals`);
  }
});

test('plugin: no em dash or spaced en dash in what it ships', () => {
  for (const f of walk(ROOT).filter((f) => /\.(md|json)$/.test(f) && !f.includes('/evals/'))) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!text.includes('—') && !/ – /.test(text), f);
  }
});
