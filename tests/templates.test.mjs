// The Claude templates and this repo's own copies: each file in templates/claude/ that the repo uses sits at the
// root byte for byte, so the repo runs what it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COPIES = ['.claude/settings.json', '.claude/skills/bump-pins/SKILL.md', '.claude/skills/product-plan/SKILL.md'];

test('templates: each root copy matches templates/claude byte for byte', () => {
  for (const file of COPIES) assert.equal(readFileSync(file, 'utf8'), readFileSync(`templates/claude/${file}`, 'utf8'), file);
});

test('templates: the settings template parses and denies the credential paths', () => {
  const deny = JSON.parse(readFileSync('templates/claude/.claude/settings.json', 'utf8')).permissions.deny;
  for (const rule of ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/*.pem)', 'Read(./**/*.key)', 'Read(~/.ssh/**)']) assert.ok(deny.includes(rule), rule);
});

test('templates: the settings template enables only claude-plugins-official plugins and denies the one-way doors', () => {
  const settings = JSON.parse(readFileSync('templates/claude/.claude/settings.json', 'utf8'));
  const ids = Object.keys(settings.enabledPlugins);
  assert.ok(ids.length > 0, 'enabledPlugins is empty');
  for (const id of ids) assert.match(id, /@claude-plugins-official$/, id);
  for (const rule of ['Bash(rm -rf ~ *)', 'Bash(git push --force *)', 'Bash(git reset --hard *)']) assert.ok(settings.permissions.deny.includes(rule), rule);
});
