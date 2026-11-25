// docs/blockers.md records which Claude pages the Chrome tool opens: its table names every page class once, each
// row says what a local session and a cloud thread get, and the README links it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const doc = readFileSync('docs/blockers.md', 'utf8');
test('blockers doc: seven page rows, each with four cells', () => {
  const table = doc.slice(doc.indexOf('| Page class'), doc.indexOf('| Rule'));
  const data = table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Page class'));
  assert.equal(data.length, 7, `${data.length} page rows`);
  for (const r of data) assert.equal(r.split('|').length, 6, r);
  assert.ok(data.some((r) => /Refused/.test(r)), 'no refusal is recorded');
  assert.ok(data.some((r) => /Opens/.test(r)), 'no open page is recorded');
});

test('blockers doc: its sources are dated and its links resolve', () => {
  assert.match(doc, /read 2026-\d\d-\d\d/);
  for (const [, t] of doc.matchAll(/\]\((?!https?:)([^)#]+)/g)) assert.ok(existsSync(`docs/${t}`), t);
});

test('blockers doc: the README links it', () => {
  assert.match(readFileSync('README.md', 'utf8'), /\(docs\/blockers\.md\)/);
});

test('blockers doc: no key, email or home path', () => {
  assert.doesNotMatch(doc, /[\w.+-]+@[\w-]+\.\w+|\/Users\/|\/home\/|sk-[A-Za-z0-9]{10}/);
});
