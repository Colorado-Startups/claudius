// The public pages' configs: quality/config.json with every metric that needs local files dropped, so the pages
// CI uploads never show, count or list one (pages.yml). The owner, 2026-11-12: the metrics of this Mac's
// Claude session are personal and never shown in public.
//
//   node quality/public.mjs [--root DIR]
//
// Writes, under DIR (default the current folder):
//   quality/public/config.json   quality/config.json, its targets, data, history and out under quality/public
//   quality/public/targets/      each targets file as written, with "drop": true on each needs "local-files" entry
//                                but an id quality/public-params.json names, which reads repo files only (needs
//                                none); its drop list goes to repo-drops.json
//   quality/public/process.json  quality/process/config.json, the Process page's, when there is one: each
//                                { "use": id } map that names one of the pack's own (maps/<id>.json) written out
//                                in full, since CI reads no pack by path; in each map, each step whose metric is
//                                dropped left out, and a map with no step left out too. Its quality config is the public one,
//                                so each step reads the public run, and its page goes to the same dist.
// A dropped entry's params still count, and a collector whose every metric is dropped does not run (Git Crafter
// quality/CONFIG.md, Overrides). The engine has no filter by needs at v6.0.0, so the drop is chosen here, by
// needs, never by a list that a new metric could miss. A --local run reads quality/config.json, the full page,
// and is never uploaded.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC = 'quality/public';

// The ids that go public from repo files alone, and the params they read them with (quality/public-params.json).
export const NO_PUBLIC = { ids: [], params: {} };
export const DROPS = 'repo-drops.json';
export const readPublicParams = (root) => {
  const file = join(root, 'quality/public-params.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : NO_PUBLIC;
};

// One targets file for the public page: an id in pub.ids needs none, and the file's params take pub.params;
// every other entry that needs local files is dropped.
export const publicTargets = (list, pub = NO_PUBLIC) => {
  const scoped = list.some((d) => pub.ids.includes(d.id));
  return list.map((def) => {
    const out = scoped && def.params ? { ...def, params: { ...def.params, ...pub.params } } : def;
    if (pub.ids.includes(def.id)) return { ...out, needs: 'none' };
    return def.needs === 'local-files' ? { ...out, drop: true } : out;
  });
};

// The public config: the repo's own, its targets, data, history and out under PUBLIC. Every tab stays: Git
// Crafter v7 stops on a target whose tab the config leaves out, dropped or not (score.mjs MOVED_TABS).
export const publicConfig = (config) => ({
  ...config,
  comment: `Written by quality/public.mjs from quality/config.json: each metric that needs local files is dropped. Never edit; rerun it.`,
  targets: `${PUBLIC}/targets`,
  data: `${PUBLIC}/data`,
  history: `${PUBLIC}/history`,
  out: `${PUBLIC}/dist`,
});

// The pack's own maps (maps/<id>.json), by id.
function packMaps(root) {
  const dir = join(root, 'maps');
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]));
}

// One map entry with each step whose metric is dropped left out, a pack map's { use } written out in full
// first; null when no step is left. A Git Crafter library map's { use } is kept as written: its steps read
// template metrics, which this file never drops.
function publicMap(entry, maps, dropped) {
  const own = entry && 'use' in entry ? maps[entry.use] : entry;
  if (!own) return entry;
  const extra = 'use' in entry ? Object.keys(entry).filter((k) => k !== 'use' && k !== 'comment') : [];
  if (extra.length) throw new Error(`quality/process/config.json map use "${entry.use}": a pack map is named by use alone; change maps/${entry.use}.json, not ${extra.join(', ')}`);
  const steps = (own.steps ?? []).filter((s) => !dropped.has(s.metric));
  if (!steps.length) return null;
  const kept = new Set(steps.map((s) => s.id));
  return { ...own, ...(own.critical_path ? { critical_path: own.critical_path.filter((id) => kept.has(id)) } : {}), steps };
}

// The public Process config: the repo's own, its maps as publicMap leaves them, read from the public run.
export function publicProcess(config, maps, dropped) {
  const kept = (config.maps ?? []).map((m) => publicMap(m, maps, dropped)).filter(Boolean);
  return {
    ...config,
    comment: `Written by quality/public.mjs from quality/process/config.json: each pack map in full, each step whose metric needs local files left out. Never edit; rerun it.`,
    docs: { ...config.docs, maps: kept.length ? `${PUBLIC}/process.json` : null },
    maps: kept,
    quality_config: `${PUBLIC}/config.json`,
    data: `${PUBLIC}/process/org.json`,
    history: null,
    out: `${PUBLIC}/dist`,
  };
}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// Writes PUBLIC under root afresh; returns the ids it dropped.
export function writePublic(root = '.') {
  const config = JSON.parse(readFileSync(join(root, 'quality/config.json'), 'utf8'));
  const from = join(root, config.targets ?? 'quality/targets');
  const out = join(root, PUBLIC);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'targets'), { recursive: true });
  const dropped = [];
  const pub = readPublicParams(root);
  for (const file of readdirSync(from).filter((f) => f.endsWith('.json')).sort()) {
    const list = publicTargets(JSON.parse(readFileSync(join(from, file), 'utf8')), pub);
    dropped.push(...list.filter((d) => d.drop === true && d.needs === 'local-files').map((d) => d.id));
    writeFileSync(join(out, 'targets', file), json(list));
  }
  // Git Crafter metrics that cannot apply here, dropped on the public page only: targets/ is the pack adopters load.
  if (pub.drop?.length) writeFileSync(join(out, 'targets', DROPS), json(pub.drop.map((id) => ({ id, drop: true }))));
  writeFileSync(join(out, 'config.json'), json(publicConfig(config)));
  const processFile = join(root, 'quality/process/config.json');
  if (existsSync(processFile)) writeFileSync(join(out, 'process.json'), json(publicProcess(JSON.parse(readFileSync(processFile, 'utf8')), packMaps(root), new Set(dropped))));
  return dropped;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const root = args[0] === '--root' && args[1] ? args[1] : args.length ? null : '.';
  if (root === null) {
    console.error('usage: node quality/public.mjs [--root DIR]');
    process.exit(2);
  }
  console.log(`public: ${writePublic(root).length} metrics that need local files dropped, wrote ${PUBLIC}/config.json, targets and process.json`);
}
