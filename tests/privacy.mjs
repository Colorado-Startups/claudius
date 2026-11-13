// The privacy gate: Claudius's public pages hold no reading from a
// maintainer's machine, and no metric that needs one. It reads the run file
// the pages are drawn from, and every file under each --dist folder, the
// folder the deploy uploads.
//
//   node tests/privacy.mjs <run.json> [targets folder ...] [--dist <folder> ...]
//
// A finding is any of these:
//   the run's mode is not ci          a --local run is never uploaded
//   a local-only metric is there      needs "local-files" in a targets folder: in the run at all, read or
//                                     not, or its id in a --dist file (quality/public.mjs drops each one)
//   a home path                       /Users/<name>, /home/<name>, C:\Users\<name>, -Users-<name>
//   an email address                  git@ remotes and noreply addresses pass
//   a name in PRIVACY_NAMES           comma separated, whole words, any case; CI reads the repo's Actions
//                                     secret, so an unset secret (a fork's pull request) skips this check and
//                                     says so
// A --dist file is text, so all but the mode apply to it. A finding in a text names its file, its line and
// its kind, never the text it matched: a name, a home path or an email never reaches the log.
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

// The line of a text an offset falls on, from 1.
const lineAt = (text, at) => text.slice(0, at).split('\n').length;

// Each line of a text where a global pattern matches a hit that keep accepts, once, in order.
const linesOf = (text, re, keep = () => true) => [...new Set([...text.matchAll(re)].filter((m) => keep(m[0])).map((m) => lineAt(text, m.index)))];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every home path, email, listed name or local-only id in a text, as "line N: kind"; [] when clean. A
// finding never holds the text it matched.
export function textProblems(text, names = [], localIds = new Set()) {
  const found = [];
  for (const id of localIds) for (const n of linesOf(text, new RegExp(escape(id), 'g'))) found.push(`line ${n}: local-only metric ${id}`);
  for (const re of HOME_PATHS) for (const n of linesOf(text, re)) found.push(`line ${n}: home path`);
  for (const n of linesOf(text, EMAIL, (e) => !EMAIL_OK(e))) found.push(`line ${n}: email`);
  const listed = names.map((n) => n.trim()).filter(Boolean);
  if (listed.length) for (const n of linesOf(text, new RegExp(`\\b(?:${listed.map(escape).join('|')})\\b`, 'gi'))) found.push(`line ${n}: a name in PRIVACY_NAMES`);
  return found;
}

// Every finding in one run; [] when clean. text is the run file as read, so a line is the file's own.
export function privacyProblems(run, { localIds = new Set(), names = [], text = JSON.stringify(run, null, 2) } = {}) {
  const found = [];
  if (run?.mode !== 'ci') found.push(`run mode is ${JSON.stringify(run?.mode)}, not "ci"`);
  for (const id of Object.keys(run?.metrics ?? {})) if (localIds.has(id)) found.push(`${id} needs local files but is in the run`);
  return [...found, ...textProblems(text, names)];
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
  const names = (process.env.PRIVACY_NAMES ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  let run, text, localIds, pages;
  try {
    text = readFileSync(file, 'utf8');
    run = JSON.parse(text);
    localIds = localOnlyIds(dirs);
    pages = dists.flatMap(filesUnder);
  } catch (err) {
    console.error(`privacy: ${err.message}`);
    process.exit(2);
  }
  if (!names.length) console.log('privacy: PRIVACY_NAMES is not set, so the name check is skipped');
  const found = privacyProblems(run, { localIds, names, text }).map((f) => f.replace(/^line (\d+):/, `${file}:$1:`));
  for (const page of pages) for (const f of textProblems(readFileSync(page, 'utf8'), names, localIds)) found.push(f.replace(/^line (\d+):/, `${page}:$1:`));
  for (const f of found) console.error(`::error::privacy: ${f}`);
  console.log(`privacy: ${Object.keys(run.metrics ?? {}).length} metrics, ${localIds.size} local-only ids, ${names.length} names, ${pages.length} dist files, ${found.length} findings`);
  process.exit(found.length ? 1 : 0);
}
