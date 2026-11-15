// Plugin trust for the desktop app collector (desktop-app.mjs): what is
// installed, from which marketplace tier, what has an Anthropic equivalent,
// and what has gone stale. Reads only names and settings: install records,
// settings files, the desktop app's plugin manifest, marketplace catalogs,
// and the names of custom skills, agents and hook commands.
//   desktop_app.plugins_untrusted    enabled plugins from community or third-party marketplaces
//   desktop_app.plugins_replaceable  enabled plugins, custom skills, agents or hooks with an Anthropic equivalent
//   desktop_app.plugins_stale        install records turned off, delisted plugins, plugins with no upstream update in params.stale_days
// Tiers follow code.claude.com/docs/en/plugins/security: a marketplace's name
// places it, and Claude Code accepts the official and community names only
// from github.com/anthropics/.

import fs from 'node:fs';
import path from 'node:path';
import { resolvePath } from '../claude/claude.mjs';
import { item } from '../instructions/instructions-lib.mjs';

// The equivalents data file, each match compiled once; a row whose match is
// no valid regular expression is left out and counted in the source.
const EQUIVALENTS = [];
let badEquivalents = 0;
for (const e of JSON.parse(fs.readFileSync(new URL('./anthropic-equivalents.json', import.meta.url), 'utf8')).equivalents ?? []) {
  try {
    EQUIVALENTS.push({ ...e, re: new RegExp(e.match) });
  } catch {
    badEquivalents += 1;
  }
}
const DAY = 864e5;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const dirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
};
const files = (dir, ext) => {
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(ext));
  } catch {
    return [];
  }
};

// A marketplace's tier by its name: anthropic (official names), reviewed
// (Anthropic's directory as the desktop app names it), community, or third-party.
export function tierOf(marketplace, params) {
  if ((params.official_marketplaces ?? []).includes(marketplace)) return 'official';
  if ((params.directory_marketplaces ?? []).includes(marketplace)) return 'directory';
  if ((params.community_marketplaces ?? []).includes(marketplace)) return 'community';
  return 'third-party';
}

// The GitHub owner of the repo's origin remote, read from its git config, so a
// marketplace from the repo owner's own GitHub account counts as the owner's.
export function repoOwner(root) {
  try {
    let gitDir = path.join(root, '.git');
    if (fs.statSync(gitDir).isFile()) gitDir = path.resolve(root, /gitdir: (.+)/.exec(fs.readFileSync(gitDir, 'utf8'))[1].trim());
    const common = fs.existsSync(path.join(gitDir, 'commondir')) ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()) : gitDir;
    const config = fs.readFileSync(path.join(common, 'config'), 'utf8');
    const origin = /\[remote "origin"\][^[]*?url = ([^\n]+)/.exec(config)?.[1] ?? '';
    return /github\.com[:/]([^/]+)\//.exec(origin)?.[1] ?? null;
  } catch {
    return null;
  }
}

// enabledPlugins merged key by key, lowest precedence first (plugins/loading).
function enabledMap(...settingsFiles) {
  return Object.assign({}, ...settingsFiles.map((f) => readJson(f)?.enabledPlugins ?? {}));
}

// Everything that adds plugins, skills, agents or hooks, as named records.
export function inventory({ home, root, params }) {
  const pluginsDir = resolvePath(params.plugins_dir, { home, root });
  const dot = params.claude_dir_name;
  const [settingsFile, localFile] = params.settings_files;
  const userSettings = path.join(home, dot, settingsFile);
  const projectSettings = (dir) => [path.join(dir, dot, settingsFile), path.join(dir, dot, localFile)];
  const known = readJson(path.join(pluginsDir, 'known_marketplaces.json')) ?? {};
  const owner = repoOwner(root);
  const own = new Set([...(params.own_marketplaces ?? []), ...Object.entries(known).filter(([, m]) => owner && String(m?.source?.repo ?? '').split('/')[0] === owner).map(([name]) => name)]);
  const plugins = [];
  // Claude Code installs, one record per scope.
  const installs = readJson(path.join(pluginsDir, 'installed_plugins.json'))?.plugins ?? {};
  for (const [id, records] of Object.entries(installs)) {
    const [name, marketplace = ''] = id.split('@');
    for (const r of records ?? []) {
      const where = r.scope === 'user' ? enabledMap(userSettings) : enabledMap(userSettings, ...projectSettings(r.projectPath ?? root));
      const gone = r.scope !== 'user' && r.projectPath && !fs.existsSync(r.projectPath);
      plugins.push({ id, name, marketplace, origin: `cli ${r.scope}`, enabled: !gone && where[id] === true, gone });
    }
  }
  // The desktop app's own plugins (Cowork and Code), by its manifest.
  const desktopOff = enabledMap(userSettings, ...projectSettings(root));
  const cowork = resolvePath(params.cowork_dir, { home, root });
  for (const account of dirs(cowork)) {
    for (const org of dirs(path.join(cowork, account))) {
      const list = readJson(path.join(cowork, account, org, 'rpm', 'manifest.json'))?.plugins;
      for (const p of Array.isArray(list) ? list : Object.values(list ?? {})) {
        if (!p?.name) continue;
        const marketplace = String(p.marketplaceName ?? '');
        plugins.push({ id: `${p.name}@${marketplace}`, name: p.name, marketplace, origin: 'desktop', enabled: desktopOff[`${p.name}@synced`] !== false && p.installationPreference !== 'unavailable' });
      }
    }
  }
  // Custom skills, agents and hook commands: the user's and this repo's.
  const custom = [];
  for (const base of [path.join(home, dot), path.join(root, dot)]) {
    for (const d of dirs(path.join(base, 'skills'))) if (!fs.existsSync(path.join(base, 'skills', d, params.plugin_manifest_dir))) custom.push({ kind: 'skill', name: d });
    for (const f of files(path.join(base, 'agents'), '.md')) custom.push({ kind: 'agent', name: f.replace(/\.md$/, '') });
  }
  for (const file of [userSettings, ...projectSettings(root)]) {
    for (const groups of Object.values(readJson(file)?.hooks ?? {})) {
      for (const g of Array.isArray(groups) ? groups : []) for (const h of g?.hooks ?? []) if (h?.command) custom.push({ kind: 'hook', name: path.basename(String(h.command).split(/\s+/).find((w) => /\.(py|sh|mjs|js)"?$/.test(w)) ?? String(h.command).split(/\s+/)[0]).replace(/"$/, '') });
    }
  }
  // The official-tier catalogs Claude Code has cloned, for names and authors.
  const catalog = {};
  for (const m of params.official_marketplaces ?? []) {
    for (const p of readJson(path.join(pluginsDir, 'marketplaces', m, params.plugin_manifest_dir, 'marketplace.json'))?.plugins ?? []) catalog[p.name] ??= { marketplace: m, author: p.author?.name ?? null };
  }
  const cache = readJson(path.join(pluginsDir, 'plugin-catalog-cache.json'));
  return { plugins, custom, own, catalog, cache: cache?.catalog?.plugins ?? {}, cacheAt: cache?.fetchedAt ?? null, flagged: readJson(path.join(pluginsDir, 'flagged-plugins.json')) ?? {} };
}

const kept = (p, params, own) => own.has(p.marketplace) || Object.hasOwn(params.kept_plugins ?? {}, p.id);
const enabledOnce = (plugins) => [...new Map(plugins.filter((p) => p.enabled).map((p) => [p.id, p])).values()];

// The three plugin readings, written through val.
export function pluginMetrics(inv, params, now, { val, cnc }) {
  if (!inv.plugins.length && !inv.custom.length) {
    for (const id of ['plugins_untrusted', 'plugins_replaceable', 'plugins_stale']) cnc(id, 'no plugin install record, desktop app plugin manifest, custom skill, agent or hook found', 'the desktop_app collector');
    return;
  }
  const enabled = enabledOnce(inv.plugins);
  const byTier = (tier) => enabled.filter((p) => tierOf(p.marketplace, params) === tier);
  const untrusted = [...byTier('community'), ...byTier('third-party')].filter((p) => !kept(p, params, inv.own)).sort((a, b) => a.id.localeCompare(b.id));
  val('plugins_untrusted', untrusted.length, 'state: enabled plugins from Claude Code install records (user settings, this repo\'s settings) and the desktop app plugin manifest under params.cowork_dir, each placed by its marketplace name in params.official_marketplaces, params.directory_marketplaces or params.community_marketplaces, else third-party; marketplaces from the repo owner\'s GitHub account, params.own_marketplaces and params.kept_plugins set aside', [
    ...['official', 'directory', 'community', 'third-party'].map((t) => item(`${t} tier, enabled`, byTier(t).length, 'plugins')),
    ...untrusted.map((p) => item(p.id, 1, 'plugins')),
  ]);
  const swaps = [];
  for (const p of enabled) {
    const official = inv.catalog[p.name];
    const tier = tierOf(p.marketplace, params);
    if ((tier === 'community' || tier === 'third-party') && official && !inv.own.has(p.marketplace)) swaps.push([p.id, `${p.name}@${official.marketplace}`]);
    for (const e of EQUIVALENTS) if (e.kind === 'plugin' && e.re.test(p.name) && !kept(p, params, inv.own)) swaps.push([p.id, e.use]);
  }
  for (const c of inv.custom) for (const e of EQUIVALENTS) if (e.kind === c.kind && e.re.test(c.name)) swaps.push([`${c.kind} ${c.name}`, e.use]);
  const replaceable = [...new Map(swaps.map(([what, use]) => [what, use])).entries()].sort();
  val('plugins_replaceable', replaceable.length, `state: enabled plugins and the custom skills, agents and hook commands in the user\'s and this repo\'s params.claude_dir_name folders, against anthropic-equivalents.json${badEquivalents ? ` (${badEquivalents} rows left out: no valid match)` : ''} and against the official-tier catalogs Claude Code has cloned (a community or third-party plugin whose name an official marketplace also lists)`, replaceable.map(([what, use]) => ({ ...item(what, 1, 'items'), use })));
  const stale = new Map();
  for (const p of inv.plugins) if (p.origin.startsWith('cli') && !p.enabled && !enabled.some((e) => e.id === p.id)) stale.set(p.id, p.gone ? 'installed for a folder that is gone' : 'installed, turned off');
  for (const id of Object.keys(inv.flagged)) stale.set(id, 'delisted by its marketplace');
  const days = Number(params.stale_days);
  for (const p of enabled) {
    const updated = Date.parse(inv.cache[p.id]?.last_updated ?? '');
    if (days > 0 && Number.isFinite(updated) && now.getTime() - updated > days * DAY) stale.set(p.id, `no upstream update in ${days} days`);
  }
  const rows = [...stale.entries()].sort();
  val('plugins_stale', rows.length, `state: Claude Code install records no settings source enables, plugins in flagged-plugins.json, and enabled plugins whose last_updated in plugin-catalog-cache.json (fetched ${inv.cacheAt ? inv.cacheAt.slice(0, 10) : 'never'}) is older than params.stale_days`, rows.map(([id, why]) => ({ ...item(id, 1, 'plugins'), why })));
}
