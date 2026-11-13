// The Claude templates and this repo's own copies: each file in templates/claude/ that the repo uses sits at the
// root byte for byte, so the repo runs what it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COPIES = ['.claude/settings.json', '.claude/agents/reviewer.md', '.claude/skills/bump-pins/SKILL.md'];

test('templates: each root copy matches templates/claude byte for byte', () => {
  for (const file of COPIES) assert.equal(readFileSync(file, 'utf8'), readFileSync(`templates/claude/${file}`, 'utf8'), file);
});

test('templates: the settings template parses and denies the credential paths', () => {
  const deny = JSON.parse(readFileSync('templates/claude/.claude/settings.json', 'utf8')).permissions.deny;
  for (const rule of ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/*.pem)', 'Read(./**/*.key)', 'Read(~/.ssh/**)']) assert.ok(deny.includes(rule), rule);
});
