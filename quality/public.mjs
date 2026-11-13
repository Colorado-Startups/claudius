// The public page's config: quality/config.json with every metric that needs local files dropped, so the page
// CI uploads never shows, counts or lists one (pages.yml). The owner, 2026-11-12: the metrics of this Mac's
// Claude session are personal and never shown in public.
//
//   node quality/public.mjs [--root DIR]
//
// Writes, under DIR (default the current folder):
//   quality/public/config.json   quality/config.json, its targets, data, history and out under quality/public
//   quality/public/targets/      each targets file as written, with "drop": true on each needs "local-files" entry
// A dropped entry's params still count, and a collector whose every metric is dropped does not run (Git Crafter
// quality/CONFIG.md, Overrides). The engine has no filter by needs at v6.0.0, so the drop is chosen here, by
// needs, never by a list that a new metric could miss. A --local run reads quality/config.json, the full page,
// and is never uploaded.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC = 'quality/public';

// One targets file with each entry that needs local files dropped.
export const publicTargets = (list) => list.map((def) => (def.needs === 'local-files' ? { ...def, drop: true } : def));

// The public config: the repo's own, its targets, data, history and out under PUBLIC.
export const publicConfig = (config) => ({
  ...config,
  comment: `Written by quality/public.mjs from quality/config.json: each metric that needs local files is dropped. Never edit; rerun it.`,
  targets: `${PUBLIC}/targets`,
  data: `${PUBLIC}/data`,
  history: `${PUBLIC}/history`,
  out: `${PUBLIC}/dist`,
});

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// Writes PUBLIC under root afresh; returns the ids it dropped.
export function writePublic(root = '.') {
  const config = JSON.parse(readFileSync(join(root, 'quality/config.json'), 'utf8'));
  const from = join(root, config.targets ?? 'quality/targets');
  const out = join(root, PUBLIC);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'targets'), { recursive: true });
  const dropped = [];
  for (const file of readdirSync(from).filter((f) => f.endsWith('.json')).sort()) {
    const list = publicTargets(JSON.parse(readFileSync(join(from, file), 'utf8')));
    dropped.push(...list.filter((d) => d.drop === true && d.needs === 'local-files').map((d) => d.id));
    writeFileSync(join(out, 'targets', file), json(list));
  }
  writeFileSync(join(out, 'config.json'), json(publicConfig(config)));
  return dropped;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const root = args[0] === '--root' && args[1] ? args[1] : args.length ? null : '.';
  if (root === null) {
    console.error('usage: node quality/public.mjs [--root DIR]');
    process.exit(2);
  }
  console.log(`public: ${writePublic(root).length} metrics that need local files dropped, wrote ${PUBLIC}/config.json and targets`);
}
