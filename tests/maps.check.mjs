// GIT_CRAFTER=<engine checkout> node --test tests/maps.check.mjs, from tests/engine-tests.sh.
// Every pack map passes the engine's own map check at the ci.yml pin, as a repo that uses it would build it.
// The Claudius public page leaves out the Decide and Equip maps, so the pages build never checks them;
// on 2026-11-19 a 30-word Decide ideal (limit 25) stopped three adopters' builds at v1.1.0.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { checkMaps } from './engine-lib.mjs';

const dir = new URL('../maps/', import.meta.url);
const maps = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

test('maps: every pack map passes the engine check a repo that uses it runs', () => {
  assert.ok(maps.length >= 5, `${maps.length} maps`);
  assert.deepEqual(checkMaps({ repo_url: 'https://github.com/Colorado-Startups/claudius', maps }), []);
});
