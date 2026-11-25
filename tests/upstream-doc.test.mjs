// docs/upstream.md pins one upstream release: a version tag, the 40-hex commit it points at, and the date it was read.
// The README names the file. No write to upstream is ever described as allowed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const doc = readFileSync('docs/upstream.md', 'utf8');
const cell = (label) => doc.match(new RegExp(`^\\| ${label}[^|]*\\| (.+) \\|$`, 'm'))?.[1];

test('upstream doc: a release tag, a 40-hex commit and a read date', () => {
  assert.match(cell('Pinned release tag'), /^`v\d+\.\d+\.\d+`$/);
  assert.match(cell('Commit'), /^`[0-9a-f]{40}`$/);
  assert.match(cell('Committed'), /^\d{4}-\d\d-\d\d$/);
  assert.match(cell('Read'), /^\d{4}-\d\d-\d\d,/);
});

test('upstream doc: upstream is read only', () => {
  assert.match(doc, /never pushes, opens a pull request, files an issue or adds a card/);
});

test('upstream doc: the README links it', () => {
  assert.match(readFileSync('README.md', 'utf8'), /\(docs\/upstream\.md\)/);
});
