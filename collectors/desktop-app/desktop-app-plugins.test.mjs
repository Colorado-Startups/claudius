// node --test collectors/desktop-app/desktop-app-plugins.test.mjs
// Every input is synthetic and written to a temp folder at run time.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { collect, PARAMS } from './desktop-app.mjs';
import { inventory, pluginMetrics, repoOwner, tierOf } from './desktop-app-plugins.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-app-plugins-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text));
};
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const now = new Date('2026-11-14T12:00:00Z');

const home = path.join(tmp, 'home');
const root = path.join(tmp, 'repo');
const plugins = path.join(home, '.claude', 'plugins');
const gone = path.join(tmp, 'moved-away');
const desktopManifest = path.join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions', 'acct', 'org', 'rpm', 'manifest.json');

// Installs: one per tier, one turned off, one for a folder that is gone.
write(path.join(plugins, 'installed_plugins.json'), {
  version: 2,
  plugins: {
    'feature-dev@claude-plugins-official': [{ scope: 'user' }],
    'cloudflare@cloudflare': [{ scope: 'user' }],
    'superpowers@claude-plugins-official': [{ scope: 'user' }],
    'odd@claude-community': [{ scope: 'user' }],
    'own-tool@acme-tools': [{ scope: 'user' }],
    'ralph-loop@claude-plugins-official': [{ scope: 'user' }],
    'explanatory-output-style@claude-plugins-official': [{ scope: 'project', projectPath: gone }],
  },
});
write(path.join(home, '.claude', 'settings.json'), {
  enabledPlugins: { 'feature-dev@claude-plugins-official': true, 'cloudflare@cloudflare': true, 'superpowers@claude-plugins-official': true, 'odd@claude-community': true, 'own-tool@acme-tools': true, 'ralph-loop@claude-plugins-official': false, 'legal-x@synced': false },
  hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'python3 -I /h/.claude/code-os/bash_guard.py' }] }], Stop: [{ hooks: [{ type: 'command', command: 'python3 -I "/h/turn_check.py"' }] }] },
});
write(path.join(plugins, 'known_marketplaces.json'), { 'acme-tools': { source: { source: 'github', repo: 'acme/tools' } }, cloudflare: { source: { source: 'github', repo: 'cloudflare/skills' } } });
write(path.join(plugins, 'marketplaces', 'claude-plugins-official', '.claude-plugin', 'marketplace.json'), { plugins: [{ name: 'cloudflare', author: { name: 'Cloudflare' } }, { name: 'feature-dev', author: { name: 'Anthropic' } }] });
write(path.join(plugins, 'plugin-catalog-cache.json'), { fetchedAt: '2026-11-01T00:00:00Z', catalog: { plugins: { 'feature-dev@claude-plugins-official': { last_updated: '2025-01-01T00:00:00Z' }, 'superpowers@claude-plugins-official': { last_updated: '2025-12-01T00:00:00Z' } } } });
write(path.join(plugins, 'flagged-plugins.json'), { 'retired@claude-plugins-official': { reason: 'delisted' } });
// The desktop app's own plugins: Anthropic's directory and an official topic marketplace.
write(desktopManifest, { lastUpdated: 1, plugins: [{ id: 'plugin_01', name: '0d5e4efa-bd29-4a82-8efe-1e3f053e048f', marketplaceName: 'anthropic-plugin-directory', installationPreference: 'available' }, { name: 'legal-x', marketplaceName: 'claude-for-legal', installationPreference: 'available' }, { id: '../../escape', name: 'stays-put', marketplaceName: 'claude-for-legal', installationPreference: 'unavailable' }] });
write(path.join(path.dirname(desktopManifest), '..', '..', 'escape', '.claude-plugin', 'plugin.json'), { name: 'escaped' });
// The directory entry's real name is in its own plugin.json.
write(path.join(path.dirname(desktopManifest), 'plugin_01', '.claude-plugin', 'plugin.json'), { name: 'brand-voice' });
// Custom pieces: a reviewer agent and a usage-report skill have Anthropic equivalents; a comfy skill has none.
write(path.join(home, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\n---\n');
write(path.join(home, '.claude', 'skills', 'usage-report', 'SKILL.md'), '---\nname: usage-report\n---\n');
write(path.join(home, '.claude', 'skills', 'comfy', 'SKILL.md'), '---\nname: comfy\n---\n');
// The repo's origin is on the acme GitHub account, so acme's marketplaces are the owner's.
write(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:acme/site.git\n');

const opts = { home, root, params: PARAMS };

test('tierOf: by marketplace name, as the plugin security docs reserve them', () => {
  assert.equal(tierOf('claude-plugins-official', PARAMS), 'official');
  assert.equal(tierOf('claude-for-legal', PARAMS), 'official');
  assert.equal(tierOf('anthropic-plugin-directory', PARAMS), 'directory');
  assert.equal(tierOf('claude-community', PARAMS), 'community');
  assert.equal(tierOf('cloudflare', PARAMS), 'third-party');
});

test('repoOwner: the GitHub owner of origin, from a checkout or a worktree', () => {
  assert.equal(repoOwner(root), 'acme');
  const wt = path.join(tmp, 'wt');
  write(path.join(root, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
  write(path.join(wt, '.git'), `gitdir: ${path.join(root, '.git', 'worktrees', 'wt')}\n`);
  assert.equal(repoOwner(wt), 'acme');
  assert.equal(repoOwner(path.join(tmp, 'nowhere')), null);
});

const run = () => {
  const out = {};
  pluginMetrics(inventory(opts), PARAMS, now, { val: (id, value, source, detail) => (out[id] = { value, source, detail }), cnc: (id, reason) => (out[id] = { could_not_check: reason }) });
  return out;
};

test('plugins_untrusted: community and third-party, the owner\'s own marketplace and a turned-off synced plugin set aside', () => {
  const r = run().plugins_untrusted;
  assert.equal(r.value, 2);
  const rows = Object.fromEntries(r.detail.map((d) => [d.label, d.value]));
  assert.deepEqual([rows['official tier, enabled'], rows['directory tier, enabled'], rows['community tier, enabled'], rows['third-party tier, enabled']], [2, 1, 1, 2], 'feature-dev and superpowers official; brand-voice directory; legal-x is turned off by its @synced key');
  assert.equal(rows['cloudflare@cloudflare'], 1);
  assert.equal(rows['odd@claude-community'], 1);
  assert.equal(rows['own-tool@acme-tools'], undefined, "acme's own marketplace is the owner's");
});

test('plugins_untrusted: kept_plugins sets a named plugin aside', () => {
  const out = {};
  pluginMetrics(inventory(opts), { ...PARAMS, kept_plugins: { 'odd@claude-community': 'no official equivalent' } }, now, { val: (id, value) => (out[id] = value), cnc: () => {} });
  assert.equal(out.plugins_untrusted, 1);
});

test('plugins_replaceable: an official listing of a third-party plugin, the equivalents file, and custom pieces', () => {
  const r = run().plugins_replaceable;
  const rows = Object.fromEntries(r.detail.map((d) => [d.label, d.use]));
  assert.equal(rows['cloudflare@cloudflare'], 'cloudflare@claude-plugins-official');
  assert.equal(rows['superpowers@claude-plugins-official'], undefined, 'superpowers is listed in the official marketplace and kept');
  assert.match(rows['agent reviewer'], /pr-review-toolkit/);
  assert.match(rows['skill usage-report'], /session-report/);
  assert.match(rows['hook bash_guard.py'], /Auto mode/);
  assert.match(rows['hook turn_check.py'], /recap/);
  assert.equal(rows['skill comfy'], undefined, 'no equivalent, not flagged');
  assert.equal(rows['ralph-loop@claude-plugins-official'], undefined, 'turned off, so not flagged here');
  assert.equal(r.value, 5);
});

test('plugins_stale: turned off, folder gone, delisted, and no upstream update in 180 days', () => {
  const r = run().plugins_stale;
  const rows = Object.fromEntries(r.detail.map((d) => [d.label, d.why]));
  assert.equal(rows['ralph-loop@claude-plugins-official'], 'installed, turned off');
  assert.equal(rows['explanatory-output-style@claude-plugins-official'], 'installed for a folder that is gone');
  assert.equal(rows['retired@claude-plugins-official'], 'delisted by its marketplace');
  assert.equal(rows['superpowers@claude-plugins-official'], 'no upstream update in 180 days');
  assert.equal(rows['feature-dev@claude-plugins-official'], undefined, 'by Anthropic, whose catalog plugins are never stale by age');
  assert.equal(r.value, 4);
  assert.match(r.source, /fetched 2026-11-01/);
});

test('an empty home: the plugin metrics are not measured, never 0', () => {
  const out = {};
  pluginMetrics(inventory({ home: path.join(tmp, 'empty'), root, params: PARAMS }), PARAMS, now, { val: (id, value) => (out[id] = value), cnc: (id, reason) => (out[id] = reason) });
  for (const id of ['plugins_untrusted', 'plugins_replaceable', 'plugins_stale']) assert.match(String(out[id]), /no plugin install record/);
});

test('plugin and connector use is read across the account: another project folder and a Cowork session count, a terminal session does not', async () => {
  const h = path.join(tmp, 'usage-home');
  const projects = path.join(h, '.claude', 'projects');
  const t = (m) => new Date(Date.parse('2026-11-14T08:00:00Z') + m * 6e4).toISOString();
  const call = (sid, m, entrypoint, skill) => ({ timestamp: t(m), sessionId: sid, entrypoint, type: 'assistant', message: { id: `${sid}${m}`, content: [{ type: 'tool_use', id: `u${m}`, name: 'Skill', input: { skill } }] } });
  const listing = { timestamp: t(100), sessionId: 'r1', entrypoint: 'claude-desktop', type: 'attachment', attachment: { type: 'skill_listing', content: 'x'.repeat(40), names: ['alpha:do', 'omega:go', 'tau:run'], skillCount: 3, isInitial: true } };
  const tools = { timestamp: t(100), sessionId: 'r1', entrypoint: 'claude-desktop', type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['Read'], addedLines: ['Read'], removedNames: [], pendingMcpServers: [], needsAuthMcpServers: [], failedMcpServers: [] } };
  write(path.join(projects, '-Users-someone-Developer-acme-site', 'r1.jsonl'), jsonl([tools, listing]));
  write(path.join(projects, '-Users-someone-Developer-other', 'o1.jsonl'), jsonl([call('o1', 10, 'claude-desktop', 'omega:go')]));
  write(path.join(projects, '-Users-someone-Developer-other', 't1.jsonl'), jsonl([call('t1', 20, 'cli', 'tau:run')]));
  write(path.join(h, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions', 'acct', 'org', 'local_abc', '.claude', 'projects', 'session', 'c1.jsonl'), jsonl([call('c1', 30, 'local-agent', 'alpha:do')]));
  const got = await collect({ root: '/Users/someone/Developer/acme site', mode: 'local', home: h, now, params: { ...PARAMS, project_match: 'acme-site' } });
  const r = got['desktop_app.plugins_unused'];
  assert.equal(r.value, 1, r.source);
  assert.deepEqual(r.detail.filter((d) => d.unit === 'calls').map((d) => d.label), ['tau'], 'only the terminal session called tau');
  assert.match(r.source, /across every project folder and Cowork session/);
});

test('desktop directory plugins go by their own plugin.json name', () => {
  const ids = inventory(opts).plugins.filter((p) => p.origin === 'desktop').map((p) => p.id).sort();
  assert.deepEqual(ids, ['brand-voice@anthropic-plugin-directory', 'legal-x@claude-for-legal', 'stays-put@claude-for-legal'], 'an id that is no plain folder name is never read');
});

test('plugins_stale: with no maintainer_author set, no plugin is exempt from the age rule', () => {
  const out = {};
  pluginMetrics(inventory(opts), { ...PARAMS, maintainer_author: '' }, now, { val: (id, value, source, detail) => (out[id] = detail), cnc: () => {} });
  assert.ok(out.plugins_stale.some((d) => d.label === 'feature-dev@claude-plugins-official'));
});
