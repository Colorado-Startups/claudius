// The pack loads from its own checkout, with no engine beside it: no file reaches past the pack
// root or to a file it lacks, and every collector file imports. Engine names arrive as lib (collectors/lib/engine.mjs).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// A relative module path in each shape a file can load one, as Git Crafter's seam.test.mjs reads it.
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+|\brequire\s*\(\s*|\.resolve\s*\(\s*)(['"`])(\.{1,2}\/[^'"`$]+)\1/gm;
// An import() whose path is built: only the tests' engine door, and this file's own loop, build one.
const BUILT = /\bimport\s*\(\s*(?!(['"`])[^'"`$]*\1\s*\))/;

const mjs = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? mjs(`${dir}${e.name}/`) : e.name.endsWith('.mjs') ? [`${dir}${e.name}`] : []));
const files = [...mjs('collectors/'), ...mjs('tests/')];

test('pack: every module a file loads by path is a pack file', () => {
  const out = files.flatMap((f) => [...readFileSync(join(ROOT, f), 'utf8').matchAll(SPEC)].map((m) => relative(ROOT, resolve(ROOT, dirname(f), m[2]))).filter((t) => t.startsWith('..') || !existsSync(join(ROOT, t))).map((t) => `${f} -> ${t}`));
  assert.deepEqual(out, []);
});

test('pack: no other file builds an import() path', () => {
  assert.deepEqual(files.filter((f) => BUILT.test(readFileSync(join(ROOT, f), 'utf8'))), ['tests/engine-lib.mjs', 'tests/pack.test.mjs']);
});

test('pack: every collector file imports with no engine beside it', async () => {
  for (const f of files.filter((x) => x.startsWith('collectors/') && !x.endsWith('.test.mjs'))) {
    const mod = await import(pathToFileURL(join(ROOT, f)).href);
    assert.ok(!('collect' in mod) || typeof mod.collect === 'function', f);
  }
});
