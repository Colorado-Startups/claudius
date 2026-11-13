// The privacy gate: Claudius's public page holds no reading from a
// maintainer's machine, and no metric that needs one. It reads the run file
// the page is drawn from, and every file under each --dist folder, the folder
// the deploy uploads.
//
//   node tests/privacy.mjs <run.json> [targets folder ...] [--dist <folder> ...]
//
// A finding is any of these:
//   the run's mode is not ci          a --local run is never uploaded
//   a local-only metric is there      needs "local-files" in a targets folder: in the run at all, read or
//                                     not, or its id in a --dist file (quality/public.mjs drops each one)
//   a home path                       /Users/<name>, /home/<name>, C:\Users\<name>, -Users-<name>
//   an email address                  git@ remotes and noreply addresses pass
//   a name in PRIVACY_NAMES           comma separated, for a local check; CI sets none
// A --dist file is text, so all but the mode apply to it.
// Exit 0 clean, 1 findings (each printed), 2 usage error.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// A redacted home prints as ~ or -Users-<user>; a CI runner's own home is no person's.
const HOME_PATHS = [/\/Users\/[A-Za-z0-9._-]+/g, /\/home\/(?!runner\b)[A-Za-z0-9._-]+/g, /[A-Za-z]:(?:\\)+Users(?:\\)+[A-Za-z0-9._-]+/g, /-Users-(?!<user>)[A-Za-z0-9_]+/g];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_OK = (e) => /^git@/.test(e) || /^noreply@/i.test(e) || /@users\.noreply\.github\.com$/i.test(e);

// The ids whose targets entry needs local files, from every *.json in each folder.
export function localOnlyIds(dirs) {
  const ids = new Set();
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      for (const def of JSON.parse(readFileSync(join(dir, file), 'utf8'))) if (def.needs === 'local-files') ids.add(def.id);
    }
  }
  return ids;
}

// Every file under a folder, depth first, as paths.
export function filesUnder(dir) {
  return readdirSync(dir).sort().flatMap((f) => (statSync(join(dir, f)).isDirectory() ? filesUnder(join(dir, f)) : [join(dir, f)]));
}

// Every home path, email, listed name or local-only id in a text; [] when clean.
export function textProblems(text, names = [], localIds = new Set()) {
  const found = [];
  for (const id of localIds) if (text.includes(id)) found.push(`local-only metric ${id}`);
  for (const re of HOME_PATHS) for (const hit of new Set(text.match(re) ?? [])) found.push(`home path ${hit}`);
  for (const hit of new Set((text.match(EMAIL) ?? []).filter((e) => !EMAIL_OK(e)))) found.push(`email ${hit}`);
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) found.push(`account name ${name}`);
  }
  return found;
}

// Every finding in one run, as text; [] when clean.
export function privacyProblems(run, { localIds = new Set(), names = [] } = {}) {
  const found = [];
  if (run?.mode !== 'ci') found.push(`run mode is ${JSON.stringify(run?.mode)}, not "ci"`);
  for (const id of Object.keys(run?.metrics ?? {})) if (localIds.has(id)) found.push(`${id} needs local files but is in the run`);
  return [...found, ...textProblems(JSON.stringify(run), names)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dists = [];
  for (let i = args.indexOf('--dist'); i !== -1; i = args.indexOf('--dist')) dists.push(args.splice(i, 2)[1]);
  const [file, ...dirs] = args;
  if (!file || dists.includes(undefined)) {
    console.error('usage: node tests/privacy.mjs <run.json> [targets folder ...] [--dist <folder> ...]');
    process.exit(2);
  }
  const names = (process.env.PRIVACY_NAMES ?? '').split(',');
  let run, localIds, pages;
  try {
    run = JSON.parse(readFileSync(file, 'utf8'));
    localIds = localOnlyIds(dirs);
    pages = dists.flatMap(filesUnder);
  } catch (err) {
    console.error(`privacy: ${err.message}`);
    process.exit(2);
  }
  const found = privacyProblems(run, { localIds, names });
  for (const page of pages) for (const f of textProblems(readFileSync(page, 'utf8'), names, localIds)) found.push(`${page}: ${f}`);
  for (const f of found) console.error(`::error::privacy: ${f}`);
  console.log(`privacy: ${Object.keys(run.metrics ?? {}).length} metrics, ${localIds.size} local-only ids, ${pages.length} dist files, ${found.length} findings`);
  process.exit(found.length ? 1 : 0);
}
