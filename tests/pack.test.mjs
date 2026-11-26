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

// Git Crafter's build stops a page on a long ideal ("ideal must be at most 25 words"), but only in a repo that pins the pack, so the pack checks it here.
// Words as the engine counts them (quality/text-rules.mjs): each run of letters is one word per 20 letters, and numbers are free.
const wordCount = (text) => (text.match(/\p{L}+/gu) ?? []).reduce((n, run) => n + Math.ceil(run.length / 20), 0);
const tooLong = (name, d) => [...['ideal', 'quality', 'speed', 'consumption'].map((k) => [k, d[k]]), ...(d.parts ?? []).flatMap((row, i) => ['ideal', 'setup'].map((k) => [`parts[${i}].${k}`, row[k]]))].filter(([, v]) => typeof v === 'string' && wordCount(v) > 25).map(([k]) => `${name} ${k}`);

test('pack: the word count is the engine rule, and the 29-word allow card ideal fails it', () => {
  assert.equal(wordCount('read-only CLAUDE.md template\'s'), 6);
  assert.equal(wordCount('a '.repeat(25) + '10 000 80% 2026'), 25);
  assert.deepEqual(tooLong('x.json', { ideal: 'A Mac thread gets one Allow once card, in a worktree if its folder is shared, and each card or prompt is answered where it was asked within minutes.' }), ['x.json ideal']);
});

test('pack: every ideal, its three lines and its parts are at most 25 words', () => {
  const long = readdirSync(join(ROOT, 'ideals')).filter((f) => f.endsWith('.json')).flatMap((f) => tooLong(f, JSON.parse(readFileSync(join(ROOT, 'ideals', f), 'utf8'))));
  assert.deepEqual(long, []);
});
