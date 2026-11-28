// GIT_CRAFTER=<engine> node --import ./tests/engine-lib.mjs --test collectors/practices/practices.test.mjs
// Every repo here is written to a temp folder at run time and indexed by git: a good one with no
// finding, and a bad one on which each rule in practices-rules.mjs fires once. No bad file is committed.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { KNOWN_KEYS } from '../claude/claude-settings.mjs';
import { loadTargets } from '../lib/engine.mjs';
import { LISTS } from './docs-drift.mjs';
import { area, audit, collect, metricIds, parseFrontmatter } from './practices.mjs';
import { DIRECTORY_RULES, EVENTS, SKILL_RULES } from './practices-rules.mjs';

// No network in tests: fetch answers each docs page with the pack's own names, so docs_drift reads 0.
const docsPages = {
  [LISTS[0].url]: [...EVENTS].map((n) => `| \`${n}\` | fires |`).join('\n'),
  [LISTS[1].url]: [...KNOWN_KEYS].map((n) => `| [\`${n}\`](#key) | does |`).join('\n'),
};
globalThis.fetch = async (url) => ({ ok: true, status: 200, text: async () => docsPages[url] });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'practices-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const json = (p, v) => write(p, JSON.stringify(v, null, 2));
const git = (root, args, input) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input });
function index(root, extra = []) {
  git(root, ['init', '-q']);
  git(root, ['config', 'core.ignorecase', 'false']);
  git(root, ['add', '-A', '-f']);
  if (!extra.length) return;
  const blob = git(root, ['hash-object', '-w', '--stdin'], 'x\n').trim();
  git(root, ['update-index', '--index-info'], extra.map((p) => `100644 ${blob}\t${p}`).join('\n') + '\n');
}

// A complete 1 by 1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const README = 'Acme Notes turns a meeting transcript into tidy notes with dated action items and named owners. It reads only the transcript you share, sends nothing anywhere, and writes the notes as Markdown in your project. It runs one shell script after each edit to format the notes, and it calls one remote server you sign in to.';
const DESC = 'Formats notes for one team. Use when notes arrive.';
const skill = (dir, fm, body = '# Skill\n\nFormat the notes.\n') => write(path.join(dir, 'SKILL.md'), `---\n${fm}\n---\n\n${body}`);

// A plugin that passes every rule; options take parts away or swap them.
function goodPlugin(dir, { name = 'acme-notes', parts = true, manifest = {} } = {}) {
  json(path.join(dir, '.claude-plugin', 'plugin.json'), {
    name,
    displayName: 'Acme Notes',
    version: '1.0.0',
    description: 'Keeps meeting notes tidy.',
    author: { name: 'Acme' },
    license: 'Apache-2.0',
    homepage: 'https://acme.example.com/notes',
    keywords: ['notes'],
    icon: './icon.png',
    documentationUrl: 'https://acme.example.com/docs',
    supportUrl: 'https://acme.example.com/help',
    privacyPolicyUrl: 'https://acme.example.com/privacy',
    termsOfServiceUrl: 'https://acme.example.com/terms',
    userConfig: { api_token: { type: 'string', title: 'API token', description: 'Token for the notes API', sensitive: true } },
    ...manifest,
  });
  fs.writeFileSync(path.join(dir, 'icon.png'), PNG);
  write(path.join(dir, 'README.md'), `# Acme Notes\n\n![icon](icon.png)\n\n${README}\n\n\`\`\`bash\nclaude plugin install acme-notes\n\`\`\`\n`);
  write(path.join(dir, 'LICENSE'), 'Apache License 2.0\n');
  if (!parts) return;
  const notes = path.join(dir, 'skills', 'taking-notes');
  skill(notes, 'name: taking-notes\ndescription: Takes tidy meeting notes with dated action items. Use when someone shares a meeting transcript.\nlicense: Apache-2.0\ncompatibility: Requires git', '# Taking notes\n\nRun `git status` before you write.\n\nSee [the format](reference.md).\n');
  write(path.join(notes, 'reference.md'), '# Format\n\nOne heading per meeting, then a list of actions.\n');
  write(path.join(dir, 'commands', 'summarize.md'), '---\ndescription: Summarize the latest notes\n---\nSummarize the notes.\n');
  write(path.join(dir, 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews notes for missing owners.\n---\nReview the notes.\n');
  // PreSkillShellCommand joined the hooks docs with Claude Code 2.1.332 (read 2026-11-27): a known event, so the good repo finds nothing.
  json(path.join(dir, 'hooks', 'hooks.json'), { hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}"/scripts/format.sh' }] }], PreSkillShellCommand: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}"/scripts/format.sh' }] }] } });
  write(path.join(dir, 'scripts', 'format.sh'), '#!/bin/sh\necho formatted\n');
  json(path.join(dir, '.mcp.json'), { mcpServers: { notes: { type: 'http', url: 'https://api.acme.example.com/mcp', headers: { Authorization: 'Bearer ${user_config.api_token}' } } } });
  for (const i of [1, 2, 3]) {
    write(path.join(dir, 'evals', `note-${i}`, 'prompt.md'), '---\nmax_turns: 5\n---\nTidy these notes from the standup.\n');
    write(path.join(dir, 'evals', `note-${i}`, 'graders', 'skill-fired.md'), `---\ntype: tool_used\ntool: Skill\ninput_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?taking-notes"'\n---\n`);
  }
}

const report = (cases, extra = {}) => ({ schemaVersion: 1, partial: false, ...extra, cases: cases.map(([name, delta]) => ({ name, aggregates: { score: 0.9, delta } })) });
const LIFT = [['note-1', 0.3], ['note-2', 0.1], ['note-3', 0.2]];
function reports(root, plugin, by = {}) {
  for (const model of ['haiku', 'sonnet', 'opus']) {
    const r = by[model] ?? report(LIFT);
    write(path.join(root, 'quality', 'evals', `${plugin}.${model}.json`), typeof r === 'string' ? r : JSON.stringify(r));
  }
}

// ------------------------------------------------------------------ good
const good = path.join(tmp, 'good');
goodPlugin(path.join(good, 'plugin'));
reports(good, 'acme-notes');
skill(path.join(good, '.claude', 'skills', 'tidy-up'), 'name: tidy-up\ndescription: Tidies a notes folder. Use when the notes folder is messy.\nwhen_to_use: After a long week of meetings.');
skill(path.join(good, '.claude', 'skills', 'review-pr'), 'name: review-pr\ndescription: Reviews a pull request. Use whenever the user asks to review a pull request.');
skill(path.join(good, '.claude', 'skills', 'rebase-check'), 'name: rebase-check\ndescription: Checks a branch. Use before merging or after a rebase.');
skill(path.join(good, '.claude', 'skills', 'listed-later'), 'name: listed-later\ndescription: Lists notes by date.\nwhen_to_use: When someone asks what was decided.');
index(good);

// ------------------------------------------------------------------- bad
const bad = path.join(tmp, 'bad');
const A = path.join(bad, 'plugins', 'acme-bad');
goodPlugin(A, {
  name: 'acme-bad',
  parts: false,
  manifest: {
    displayName: 'Acme Bаd',
    version: undefined,
    license: undefined,
    homepage: undefined,
    keywords: undefined,
    icon: undefined,
    documentationUrl: undefined,
    supportUrl: undefined,
    privacyPolicyUrl: undefined,
    termsOfServiceUrl: undefined,
    mcpServer: {},
    agents: ['../shared/agent.md'],
    hooks: './hooks/hooks.json',
    mcpServers: ['./mcp/extra.json', './server.mcpb', 'https://cdn.acme.example.com/server.mcpb'],
  },
});
write(path.join(A, 'README.md'), 'Acme Bad does things with notes for you today.\n');
fs.rmSync(path.join(A, 'LICENSE'));
write(path.join(A, '.DS_Store'), 'x');
fs.symlinkSync('README.md', path.join(A, 'link.md'));
write(path.join(A, 'assets', 'big.png'), 'x'.repeat(5 * 1024 * 1024));
fs.writeFileSync(path.join(A, 'assets', 'logo.png'), PNG);
write(path.join(A, 'data.txt'), 'y'.repeat(300 * 1024));
fs.writeFileSync(path.join(A, 'tool.bin'), Buffer.from([0, 1, 2, 3, 0]));
json(path.join(A, '.mcp.json'), {
  mcpServers: {
    docs: { command: 'npx', args: ['-y', 'acme-docs-server'] },
    pinned: { command: 'uvx', args: ['acme-tool==1.2.3'] },
    scripted: { command: 'npm', args: ['run', 'serve'] },
    local: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'] },
    api: { type: 'http', url: 'https://api.acme.example.com/mcp', headers: { Authorization: 'Bearer sk-live-1234567890abcdef' } },
    old: { type: 'sse', url: 'http://api.acme.example.com/sse' },
  },
});
write(path.join(A, 'server.js'), 'console.log(1);\n');
write(path.join(A, '.npmrc'), 'registry=https://npm.acme.example.com/\n');
write(path.join(A, 'mcp', 'extra.json'), '{ "mcpServers": ');
json(path.join(A, 'hooks', 'hooks.json'), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 -c "print(1)"' }] }], OnMagic: [] } });
write(path.join(A, 'package.json'), '{ "name": "acme-bad" }\n');
write(path.join(A, 'package-lock.json'), '{}\n');
write(path.join(A, 'commands', 'show.md'), '---\ndescription: Show the logo\n---\nOpen assets/logo.png and show it.\n');
write(path.join(A, 'commands', 'broken.md'), '---\ndescription: "unclosed\n---\nBroken.\n');
write(path.join(A, 'commands', 'bare.md'), 'No frontmatter here.\n');
write(path.join(A, 'scripts', 'fetch.sh'), '#!/bin/sh\ncurl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user\n');
write(path.join(A, 'hook', 'notes.md'), 'A folder named one letter short of hooks.\n');
// One skill per skill rule, each otherwise sound.
const S = (name) => path.join(A, 'skills', name);
skill(S('Upper_Case'), `name: Upper_Case\ndescription: ${DESC}`);
skill(S('double--dash'), `name: double--dash\ndescription: ${DESC}`);
skill(S('folder-x'), `name: other-name\ndescription: ${DESC}`);
skill(S('claude-helper'), `name: claude-helper\ndescription: ${DESC}`);
skill(S('long-desc'), `name: long-desc\ndescription: ${DESC} ${'x'.repeat(1100)}`);
skill(S('xml-desc'), 'name: xml-desc\ndescription: Formats <b>notes</b>. Use when notes arrive.');
skill(S('second-person'), 'name: second-person\ndescription: You can use this to format notes. Use when notes arrive.');
skill(S('no-when'), 'name: no-when\ndescription: Formats notes for meetings.');
skill(S('extra-field'), `name: extra-field\ndescription: ${DESC}\nmodel: haiku`);
skill(S('long-body'), `name: long-body\ndescription: ${DESC}`, Array.from({ length: 500 }, (_, i) => `Line ${i}.`).join('\n') + '\n');
skill(S('no-toc'), `name: no-toc\ndescription: ${DESC}`, 'See [the reference](reference.md).\n');
write(path.join(S('no-toc'), 'reference.md'), Array.from({ length: 120 }, (_, i) => `Row ${i}.`).join('\n') + '\n');
skill(S('nested-ref'), `name: nested-ref\ndescription: ${DESC}`, 'See [the guide](guide.md).\n');
write(path.join(S('nested-ref'), 'guide.md'), 'See [the details](details.md).\n');
write(path.join(S('nested-ref'), 'details.md'), 'Details.\n');
skill(S('backslash'), `name: backslash\ndescription: ${DESC}`, 'Run `scripts\\run.sh` first.\n');
skill(S('uses-gh'), `name: uses-gh\ndescription: ${DESC}`, '```bash\ngh pr list\n```\n');
skill(path.join(bad, '.claude', 'skills', 'listing-cap'), `name: listing-cap\ndescription: ${DESC} ${'y'.repeat(940)}\nwhen_to_use: ${'z'.repeat(600)}`);
// One plugin per name rule, and one per manifest that does not parse.
goodPlugin(path.join(bad, 'plugins', 'b'), { name: 'ünïcode-notes', parts: false });
goodPlugin(path.join(bad, 'plugins', 'c'), { name: 'Acme_Tools', parts: false });
goodPlugin(path.join(bad, 'plugins', 'd'), { name: 'claude', parts: false });
goodPlugin(path.join(bad, 'plugins', 'e x'), { name: 'test-plugin', parts: false });
goodPlugin(path.join(bad, 'plugins', 'f'), { parts: false });
write(path.join(bad, 'plugins', 'f', '.claude-plugin', 'plugin.json'), '{ "name": ');
write(path.join(bad, '.gitattributes'), '*.md export-ignore\n');
// Entries no Mac folder can hold side by side, and the bulk past the portal's limits, go in git's index only.
index(bad, [
  'docs/con.md',
  'docs/Notes.md',
  'docs/notes.md',
  ...Array.from({ length: 513 }, (_, i) => `plugins/acme-bad/pages/p${i}.md`),
  ...Array.from({ length: 10000 }, (_, i) => `bulk/f${i}.txt`),
]);

const RULES = [...DIRECTORY_RULES, ...SKILL_RULES];
const counts = (found) => Object.fromEntries(RULES.map((r) => [r.id, found.filter((f) => f.rule === r.id).length]));

test('rules: each row has an id of its own, a result or metric, an https doc and a check', () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  for (const r of DIRECTORY_RULES) assert.ok(['blocks', 'holds', 'warning'].includes(r.result), r.id);
  for (const r of SKILL_RULES) assert.ok(['skill_rules', 'skill_size', 'skill_tools_unnamed'].includes(r.metric), r.id);
  for (const r of RULES) assert.ok(/^https:\/\//.test(r.doc) && typeof r.check === 'function' && r.title, r.id);
});

test('good repo: no rule finds anything', async () => {
  const { findings } = await audit({ root: good });
  assert.deepEqual(findings, []);
});

test('bad repo: every rule fires once', async () => {
  const { findings } = await audit({ root: bad });
  assert.deepEqual(counts(findings), Object.fromEntries(RULES.map((r) => [r.id, 1])));
  for (const f of findings) assert.ok(f.file && !path.isAbsolute(f.file), `${f.rule}: ${f.file}`);
});

test('collect: the good repo scores at goal, its listing tokens are its names and descriptions over 4', async () => {
  const out = await collect({ root: good, mode: 'ci' });
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  const values = Object.fromEntries(Object.entries(out).map(([id, m]) => [id, m.value]));
  const always = ['taking-notes', 'Takes tidy meeting notes with dated action items. Use when someone shares a meeting transcript.', 'summarize', 'Summarize the latest notes', 'reviewer', 'Reviews notes for missing owners.'].join('').length;
  assert.deepEqual(values, {
    'practices.directory_blocks': 0,
    'practices.directory_holds': 0,
    'practices.directory_warnings': 0,
    'practices.listing_fields_missing': 0,
    'practices.skill_rules': 0,
    'practices.skill_size': 0,
    'practices.skill_tools_unnamed': 0,
    'practices.listing_tokens': Math.round(always / 4),
    'practices.skills_under_three_evals': 0,
    'practices.skills_without_lift': 0,
    'practices.docs_drift': 0,
  });
  assert.ok(out['practices.listing_tokens'].detail.some((d) => d.label === 'acme-notes/taking-notes'));
});

test('collect: docs_drift counts each name one side lacks, and docs that cannot be read are not measured', async () => {
  const drifted = { ...docsPages, [LISTS[0].url]: `${docsPages[LISTS[0].url]}\n| \`PreNewThing\` | fires |` };
  const out = await collect({ root: good, mode: 'ci', docs: async () => drifted });
  assert.equal(out['practices.docs_drift'].value, 1);
  assert.deepEqual(out['practices.docs_drift'].detail, [{ label: 'hook events: PreNewThing, in the docs, not in the pack', value: 1, unit: 'names' }]);
  const offline = await collect({ root: good, mode: 'ci', docs: async () => { throw new Error('offline'); } });
  assert.match(offline['practices.docs_drift'].could_not_check, /offline/);
  assert.equal(offline['practices.skill_rules'].value, 0);
});

test('collect: the bad repo counts each finding by its result and names its file, rule and doc', async () => {
  const out = await collect({ root: bad, mode: 'ci' });
  const n = (result) => DIRECTORY_RULES.filter((r) => r.result === result).length;
  const m = (metric) => SKILL_RULES.filter((r) => r.metric === metric).length;
  assert.equal(out['practices.directory_blocks'].value, n('blocks'));
  assert.equal(out['practices.directory_holds'].value, n('holds'));
  assert.equal(out['practices.directory_warnings'].value, n('warning'));
  assert.equal(out['practices.skill_rules'].value, m('skill_rules'));
  assert.equal(out['practices.skill_size'].value, m('skill_size'));
  assert.equal(out['practices.skill_tools_unnamed'].value, m('skill_tools_unnamed'));
  // acme-bad sets displayName only; f's manifest does not parse, so its fields are the manifest_json block's.
  assert.equal(out['practices.listing_fields_missing'].value, 7);
  assert.equal(out['practices.skills_under_three_evals'].value, 14);
  assert.equal(out['practices.skills_without_lift'].value, 14);
  assert.ok(out['practices.listing_tokens'].value > 0);
  const row = out['practices.directory_blocks'].detail.find((d) => d.label.startsWith('plugins/acme-bad/.DS_Store'));
  assert.match(row.label, /pre-submission-checklist/);
  for (const id of metricIds) assert.ok(out[id].source && (out[id].read_at || out[id].could_not_check), id);
});

test('collect: with no plugin folder the plugin rows are not measured and .claude/skills still score', async () => {
  const root = path.join(tmp, 'skills-only');
  skill(path.join(root, '.claude', 'skills', 'Bad'), `name: Bad\ndescription: ${DESC}`);
  index(root);
  const out = await collect({ root, mode: 'ci' });
  for (const id of ['directory_blocks', 'directory_holds', 'directory_warnings', 'listing_fields_missing', 'listing_tokens', 'skills_under_three_evals', 'skills_without_lift']) {
    assert.equal(out[`practices.${id}`].could_not_check, 'no .claude-plugin/plugin.json', id);
  }
  assert.equal(out['practices.skill_rules'].value, 1);
  assert.equal(out['practices.skill_size'].value, 0);
});

test('collect: a partial eval report is left out, so its skill shows no lift; one that does not parse is not measured', async () => {
  const partial = path.join(tmp, 'partial');
  goodPlugin(path.join(partial, 'plugin'));
  reports(partial, 'acme-notes', { opus: report(LIFT, { partial: true }) });
  index(partial);
  const out = await collect({ root: partial, mode: 'ci' });
  assert.equal(out['practices.skills_without_lift'].value, 1);
  assert.match(out['practices.skills_without_lift'].detail[0].label, /opus.*partial/);

  const flat = path.join(tmp, 'flat');
  goodPlugin(path.join(flat, 'plugin'));
  reports(flat, 'acme-notes', { sonnet: report([['note-1', 0], ['note-2', -0.2], ['note-3', 0.1]]) });
  index(flat);
  assert.equal((await collect({ root: flat, mode: 'ci' }))['practices.skills_without_lift'].value, 1);

  const broken = path.join(tmp, 'broken');
  goodPlugin(path.join(broken, 'plugin'));
  reports(broken, 'acme-notes', { haiku: '{ "cases": ' });
  index(broken);
  assert.match((await collect({ root: broken, mode: 'ci' }))['practices.skills_without_lift'].could_not_check, /acme-notes\.haiku\.json/);
});

test('collect: a grader regex with a nested quantifier proves nothing, so a pull request cannot stall CI on it', async () => {
  const root = path.join(tmp, 'redos');
  goodPlugin(path.join(root, 'plugin'));
  reports(root, 'acme-notes');
  write(path.join(root, 'plugin', 'evals', 'note-3', 'graders', 'skill-fired.md'), `---\ntype: tool_used\ntool: Skill\ninput_match: '"skill"\\s*:\\s*"[\\w-]+:(?:[\\w-]+)+notes"'\n---\n`);
  index(root);
  const out = await collect({ root, mode: 'ci' });
  assert.equal(out['practices.skills_under_three_evals'].value, 1);
  assert.deepEqual(out['practices.skills_under_three_evals'].detail, [{ label: 'acme-notes:taking-notes', value: 2, unit: 'cases' }]);
});

test('collect: outside git, the walk skips params.skip_dirs', async () => {
  const root = path.join(tmp, 'walked');
  goodPlugin(path.join(root, 'plugin'));
  reports(root, 'acme-notes');
  goodPlugin(path.join(root, 'node_modules', 'other'), { name: 'Other_Name' });
  goodPlugin(path.join(root, 'fixtures', 'bad'), { name: 'claude' });
  const { findings, plugins } = await audit({ root });
  assert.deepEqual(plugins.map((p) => p.dir), ['plugin']);
  assert.deepEqual(findings, []);
});

test('parseFrontmatter: quoted, folded and listed values; an unclosed quote, a list description and a bare colon do not parse as text', () => {
  const ok = parseFrontmatter('---\nname: a\ndescription: >\n  one\n  two\nmetadata:\n  author: x\npaths:\n  - "x/**"\ninput_match: \'"skill"\\s*:\\s*"a"\'\n---\nbody\n');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.fields, { name: 'a', description: 'one two', metadata: { author: 'x' }, paths: ['x/**'], input_match: '"skill"\\s*:\\s*"a"' });
  assert.equal(ok.body, 'body\n');
  assert.equal(parseFrontmatter('---\ndescription: "open\n---\n').ok, false);
  assert.equal(parseFrontmatter('---\ndescription: one: two\n---\n').ok, false);
  assert.deepEqual(parseFrontmatter('---\ndescription:\n  - a\n  - b\n---\n').fields.description, ['a', 'b']);
  assert.equal(parseFrontmatter('no frontmatter').has, false);
});

test('targets: the engine loads every metric on the practices tab, none needs local files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-targets-'));
  fs.copyFileSync(new URL('../../targets/practices.json', import.meta.url), path.join(dir, 'practices.json'));
  const defs = loadTargets(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(area, 'practices');
  assert.deepEqual(defs.map((d) => d.id), metricIds);
  for (const d of defs) assert.ok(d.tab === 'practices' && d.needs === undefined, d.id);
  assert.deepEqual(new Set(defs.map((d) => d.kind)), new Set(['quality', 'speed', 'consumption']));
});
