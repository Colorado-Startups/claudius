// node --test collectors/practices/docs-drift.test.mjs
// Every page here is a sample built in the test, laid out as the docs lay theirs out. No network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KNOWN_KEYS } from '../claude/claude-settings.mjs';
import { LISTS, drift, readDocs } from './docs-drift.mjs';
import { EVENTS } from './practices-rules.mjs';

const [HOOKS, SETTINGS] = LISTS.map((l) => l.url);
const hooksPage = (names) => names.map((n) => `| \`${n}\` | When it fires |`).join('\n');
const settingsPage = (names) => names.map((n) => `| [\`${n}\`](#${n.toLowerCase()}) | What it does |`).join('\n');
const events = [...EVENTS];
const keys = [...KNOWN_KEYS].filter((k) => k !== '$schema');
const clean = { [HOOKS]: hooksPage(events), [SETTINGS]: settingsPage(keys) };

test('drift: pages that list the pack\'s own names find nothing, and $schema is not a setting', () => {
  assert.deepEqual(drift(clean), []);
});

test('drift: a name only the docs list and a name only the pack lists are one finding each', () => {
  const pages = { [HOOKS]: hooksPage([...events.slice(1), 'PreNewThing']), [SETTINGS]: settingsPage([...keys, 'newSetting']) };
  assert.deepEqual(drift(pages), [
    { list: 'hook events', name: 'PreNewThing', side: 'in the docs, not in the pack' },
    { list: 'hook events', name: events[0], side: 'in the pack, not in the docs' },
    { list: 'settings keys', name: 'newSetting', side: 'in the docs, not in the pack' },
  ]);
});

test('drift: a page whose tables changed shape is an error, never a list of findings', () => {
  assert.throws(() => drift({ ...clean, [HOOKS]: '# Hooks\n\nNo table here.' }), /changed shape/);
  assert.throws(() => drift({ [HOOKS]: clean[HOOKS] }), /changed shape/);
});

test('readDocs: asks for each page once, and a page that does not load is an error', async () => {
  const asked = [];
  const pages = await readDocs(async (url) => {
    asked.push(url);
    return { ok: true, status: 200, text: async () => clean[url] };
  });
  assert.deepEqual(asked, [HOOKS, SETTINGS]);
  assert.deepEqual(drift(pages), []);
  await assert.rejects(readDocs(async () => ({ ok: false, status: 503, text: async () => '' })), { message: `${HOOKS}: answered 503` });
  // A network error names its page, so the reason on the tab says which read failed.
  await assert.rejects(readDocs(async () => { throw new Error('fetch failed'); }), { message: `${HOOKS}: fetch failed` });
});
