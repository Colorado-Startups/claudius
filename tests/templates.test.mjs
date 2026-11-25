// The Claude templates and this repo's own copies: each file in templates/claude/ that the repo uses sits at the
// root byte for byte, so the repo runs what it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COPIES = ['.claude/settings.json', '.claude/skills/bump-pins/SKILL.md'];

test('templates: each root copy matches templates/claude byte for byte', () => {
  for (const file of COPIES) assert.equal(readFileSync(file, 'utf8'), readFileSync(`templates/claude/${file}`, 'utf8'), file);
});

test('templates: the settings template parses and denies the credential paths', () => {
  const deny = JSON.parse(readFileSync('templates/claude/.claude/settings.json', 'utf8')).permissions.deny;
  for (const rule of ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/*.pem)', 'Read(./**/*.key)', 'Read(~/.ssh/**)']) assert.ok(deny.includes(rule), rule);
});

test('templates: the settings template enables claude-plugins-official plugins, plus this repo\'s own claudius plugin', () => {
  const settings = JSON.parse(readFileSync('templates/claude/.claude/settings.json', 'utf8'));
  const ids = Object.keys(settings.enabledPlugins);
  assert.ok(ids.length > 0, 'enabledPlugins is empty');
  // claudius is published from this repo (plugin/, .claude-plugin/marketplace.json) until Anthropic's directory lists it.
  for (const id of ids) assert.match(id, /@claude-plugins-official$|^claudius@claudius$/, id);
  assert.equal(settings.extraKnownMarketplaces?.claudius?.source?.repo, 'Colorado-Startups/claudius');
});

// A Bash rule matches the whole command text, and each * matches any text, empty included
// (code.claude.com/docs/en/permissions; checked with claude -p on echo, 2026-11-15). These rules
// end in no ' *', so the docs' bare-command case for a trailing ' *' does not arise.
const denies = (rules, cmd) => rules.some((rule) => {
  const m = /^Bash\((.*)\)$/s.exec(rule);
  return m !== null && new RegExp(`^${m[1].split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(cmd);
});

test('templates: the one-way-door deny rules catch each common spelling and leave everyday commands alone', () => {
  const deny = JSON.parse(readFileSync('templates/claude/.claude/settings.json', 'utf8')).permissions.deny;
  const doors = ['rm -rf ~', 'rm -rf ~/', 'rm -fr ~', 'rm -fr ~/', 'rm -r -f ~', 'rm -rf ~ /tmp/x', 'rm -rf $HOME', 'rm -rf $HOME/', 'rm -rf $HOME /tmp/x', 'rm -rf "$HOME"', 'rm -rf "$HOME" x',
    'git push --force', 'git push --force origin main', 'git push origin main --force', 'git push --force-with-lease origin x',
    'git push -f origin x', 'git push origin x -f', 'git reset --hard', 'git reset --hard origin/main', 'git reset HEAD~1 --hard'];
  for (const cmd of doors) assert.ok(denies(deny, cmd), cmd);
  for (const cmd of ['rm -rf build/', 'rm -rf ~/proj/build', 'rm -rf ~/.cache/x', 'rm -fr ~/Downloads/old', 'git push origin main', 'git push -u origin claude/fix-force', 'git push --follow-tags', 'git reset --soft HEAD~1']) assert.ok(!denies(deny, cmd), cmd);
});

test('templates: the Code Project template links its agents, and each agent file is read only with a model', () => {
  const readme = readFileSync('templates/claude/code-project/README.md', 'utf8');
  for (const name of ['explorer', 'reviewer']) {
    assert.ok(readme.includes(`agents/${name}.md`), `${name} is linked`);
    const text = readFileSync(`templates/claude/code-project/agents/${name}.md`, 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
    assert.match(front, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(front, /^description: .+/m);
    assert.match(front, /^model: (haiku|sonnet)$/m);
    assert.doesNotMatch(front, /^tools:.*\b(Edit|Write)\b/m, `${name} must not edit`);
  }
});

test('templates: the Code Project template carries no em dash and links Git Crafter instead of copying it', () => {
  const readme = readFileSync('templates/claude/code-project/README.md', 'utf8');
  assert.ok(!readme.includes('\u2014'), 'em dash');
  assert.match(readme, /SoulCraft-Org\/git-crafter\/(tree|blob)\/main\/templates\/projects/);
});
