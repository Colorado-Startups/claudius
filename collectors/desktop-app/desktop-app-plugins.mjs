// Plugin trust for the desktop app collector (desktop-app.mjs): what is
// installed, from which marketplace tier, and what has gone stale. Reads
// only names and settings: install records, settings files, the desktop app's
// plugin manifest and marketplace catalogs.
//   desktop_app.plugins_untrusted    enabled plugins from community or third-party marketplaces
//   desktop_app.plugins_stale        install records turned off, delisted plugins, plugins with no upstream update in params.stale_days
//                                    (reported to turn back on, add the official one or fix; nothing is turned off: templates/claude/README.md#all-on-app-wide)
//   desktop_app.off_switches         settings that turn something off, in the user, project and local settings files
// Tiers follow code.claude.com/docs/en/plugins/security: a marketplace's name
// places it, and Claude Code accepts the official and community names only
// from github.com/anthropics/.

import fs from 'node:fs';
import path from 'node:path';
import { resolvePath } from '../claude/claude.mjs';
import { item } from '../instructions/instructions-lib.mjs';

const DAY = 864e5;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const isObject = (d) => d !== null && typeof d === 'object' && !Array.isArray(d);
const dirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
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

// The settings files in precedence order, lowest first (settings): user, the repo's shared project file, the repo's local file.
function settingsFiles({ home, root, params }) {
  const dot = params.claude_dir_name;
  const [settingsFile, localFile] = params.settings_files;
  return [path.join(home, dot, settingsFile), path.join(root, dot, settingsFile), path.join(root, dot, localFile)];
}

// Every setting that turns a plugin, skill or connector off, as one row each: a key set to
// its off value in params.off_booleans, a skillOverrides entry whose value is in
// params.skill_override_off, an enabledPlugins entry that is false. A key set in several files
// counts once, by the file that wins. null when no settings file can be read.
export function offSwitches({ home, root, params }) {
  const files = settingsFiles({ home, root, params });
  // A file that is there but does not parse would be skipped, and the count would read too low: not measured instead.
  if (files.some((f) => fs.existsSync(f) && !isObject(readJson(f)))) throw new Error('a settings file cannot be read or parsed');
  const docs = files.map(readJson).filter(isObject);
  if (!docs.length) return null;
  const merged = Object.assign({}, ...docs);
  const rows = [];
  for (const [key, off] of Object.entries(params.off_booleans ?? {})) if (merged[key] === off) rows.push(key);
  const overrides = Object.assign({}, ...docs.map((d) => (isObject(d.skillOverrides) ? d.skillOverrides : {})));
  for (const [skill, value] of Object.entries(overrides)) if ((params.skill_override_off ?? []).includes(value)) rows.push(`skillOverrides: ${skill}`);
  for (const [id, on] of Object.entries(enabledMap(...settingsFiles({ home, root, params })))) if (on === false) rows.push(`enabledPlugins: ${id}`);
  return rows.sort();
}

// Everything that adds plugins, as named records.
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
      const store = path.join(cowork, account, org, 'rpm');
      const list = readJson(path.join(store, 'manifest.json'))?.plugins;
      for (const p of Array.isArray(list) ? list : Object.values(list ?? {})) {
        if (!p?.name) continue;
        // The name a plugin loads under (and its @synced key) is its own
        // plugin.json's; a directory entry's manifest name may be an id. Only a
        // plain folder id is read, so no entry reaches outside the store.
        const own = /^[\w-]+$/.test(String(p.id ?? '')) ? readJson(path.join(store, p.id, params.plugin_manifest_dir, 'plugin.json'))?.name : null;
        const name = String(own || p.name);
        const marketplace = String(p.marketplaceName ?? '');
        plugins.push({ id: `${name}@${marketplace}`, name, marketplace, origin: 'desktop', enabled: desktopOff[`${name}@synced`] !== false && p.installationPreference !== 'unavailable' });
      }
    }
  }
  // The official-tier catalogs Claude Code has cloned, for names and authors.
  const catalog = {};
  for (const m of params.official_marketplaces ?? []) {
    for (const p of readJson(path.join(pluginsDir, 'marketplaces', m, params.plugin_manifest_dir, 'marketplace.json'))?.plugins ?? []) catalog[p.name] ??= { marketplace: m, author: p.author?.name ?? null };
  }
  const cache = readJson(path.join(pluginsDir, 'plugin-catalog-cache.json'));
  return { plugins, own, catalog, cache: cache?.catalog?.plugins ?? {}, cacheAt: cache?.fetchedAt ?? null, flagged: readJson(path.join(pluginsDir, 'flagged-plugins.json')) ?? {} };
}

const kept = (p, params, own) => own.has(p.marketplace) || Object.hasOwn(params.kept_plugins ?? {}, p.id);
const enabledOnce = (plugins) => [...new Map(plugins.filter((p) => p.enabled).map((p) => [p.id, p])).values()];

// The two plugin readings, written through val.
export function pluginMetrics(inv, params, now, { val, cnc }) {
  if (!inv.plugins.length) {
    for (const id of ['plugins_untrusted', 'plugins_stale']) cnc(id, 'no plugin install record or desktop app plugin manifest found', 'the desktop_app collector');
    return;
  }
  const enabled = enabledOnce(inv.plugins);
  const byTier = (tier) => enabled.filter((p) => tierOf(p.marketplace, params) === tier);
  const untrusted = [...byTier('community'), ...byTier('third-party')].filter((p) => !kept(p, params, inv.own)).sort((a, b) => a.id.localeCompare(b.id));
  val('plugins_untrusted', untrusted.length, 'state: enabled plugins from Claude Code install records (user settings, this repo\'s settings) and the desktop app plugin manifest under params.cowork_dir, each placed by its marketplace name in params.official_marketplaces, params.directory_marketplaces or params.community_marketplaces, else third-party; marketplaces from the repo owner\'s GitHub account, params.own_marketplaces and params.kept_plugins set aside', [
    ...['official', 'directory', 'community', 'third-party'].map((t) => item(`${t} tier, enabled`, byTier(t).length, 'plugins')),
    ...untrusted.map((p) => item(p.id, 1, 'plugins')),
  ]);
  const stale = new Map();
  for (const p of inv.plugins) if (p.origin.startsWith('cli') && !p.enabled && !enabled.some((e) => e.id === p.id)) stale.set(p.id, p.gone ? 'installed for a folder that is gone' : 'installed, turned off');
  for (const id of Object.keys(inv.flagged)) stale.set(id, 'delisted by its marketplace');
  const days = Number(params.stale_days);
  for (const p of enabled) {
    // A plugin Anthropic maintains in its own catalog is stable, not abandoned.
    if (params.maintainer_author && inv.catalog[p.name]?.author === params.maintainer_author) continue;
    const updated = Date.parse(inv.cache[p.id]?.last_updated ?? '');
    if (days > 0 && Number.isFinite(updated) && now.getTime() - updated > days * DAY) stale.set(p.id, `no upstream update in ${days} days`);
  }
  const rows = [...stale.entries()].sort();
  val('plugins_stale', rows.length, `state: Claude Code install records no settings source enables, plugins in flagged-plugins.json, and enabled plugins whose last_updated in plugin-catalog-cache.json (fetched ${inv.cacheAt ? inv.cacheAt.slice(0, 10) : 'never'}) is older than params.stale_days`, rows.map(([id, why]) => ({ ...item(id, 1, 'plugins'), why })));
}

// The off-switch reading, written through val.
export function offSwitchMetric(rows, { val, cnc }) {
  if (!rows) return cnc('off_switches', 'no user, project or local settings file found', 'the desktop_app collector');
  val('off_switches', rows.length, 'state: user, project and local settings files (params.settings_files), each key counted once by the file that wins: params.off_booleans at its off value, skillOverrides values in params.skill_override_off, enabledPlugins entries that are false', rows.map((r) => item(r, 1, 'switches')));
}
