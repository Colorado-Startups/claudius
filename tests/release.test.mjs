import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('release: VERSION is one semantic version', () => {
  assert.match(read('VERSION').trim(), /^\d+\.\d+\.\d+$/);
});

test('release: the workflow runs on a VERSION change, writes only in its job, and uses no secret but the workflow token', () => {
  const w = read('.github/workflows/release.yml');
  assert.match(w, /paths: \[VERSION\]/);
  assert.match(w, /^permissions:\n {2}contents: read/m);
  assert.equal([...w.matchAll(/\bsecrets\./g)].length, 0);
  assert.match(w, /already released/);
});

test('release: the version is checked as a regex and only main can release', () => {
  const w = read('.github/workflows/release.yml');
  assert.match(w, /grep -Eqx '\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+'/);
  assert.match(w, /if: github\.ref == 'refs\/heads\/main'/);
});
