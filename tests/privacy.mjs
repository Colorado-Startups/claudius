// The privacy gate: Claudius's public page holds no reading from a
// maintainer's machine. It reads the run file the page is drawn from.
//
//   node tests/privacy.mjs <run.json> [targets folder ...]
//
// A finding is any of these:
//   the run's mode is not ci          a --local run is never uploaded
//   a local-only metric has a value   needs "local-files" in a targets folder
//   a home path                       /Users/<name>, /home/<name>, C:\Users\<name>, -Users-<name>
//   an email address                  git@ remotes and noreply addresses pass
//   a name in PRIVACY_NAMES           comma separated, for a local check; CI sets none
// Exit 0 clean, 1 findings (each printed), 2 usage error.
import { readdirSync, readFileSync } from 'node:fs';
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

// Every finding in one run, as text; [] when clean.
export function privacyProblems(run, { localIds = new Set(), names = [] } = {}) {
  const found = [];
  if (run?.mode !== 'ci') found.push(`run mode is ${JSON.stringify(run?.mode)}, not "ci"`);
  for (const [id, m] of Object.entries(run?.metrics ?? {})) {
    if (localIds.has(id) && (m?.value != null || m?.detail?.length)) found.push(`${id} needs local files but carries a value`);
  }
  const text = JSON.stringify(run);
  for (const re of HOME_PATHS) for (const hit of new Set(text.match(re) ?? [])) found.push(`home path ${hit}`);
  for (const hit of new Set((text.match(EMAIL) ?? []).filter((e) => !EMAIL_OK(e)))) found.push(`email ${hit}`);
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) found.push(`account name ${name}`);
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...dirs] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node tests/privacy.mjs <run.json> [targets folder ...]');
    process.exit(2);
  }
  let run, localIds;
  try {
    run = JSON.parse(readFileSync(file, 'utf8'));
    localIds = localOnlyIds(dirs);
  } catch (err) {
    console.error(`privacy: ${err.message}`);
    process.exit(2);
  }
  const found = privacyProblems(run, { localIds, names: (process.env.PRIVACY_NAMES ?? '').split(',') });
  for (const f of found) console.error(`::error::privacy: ${f}`);
  console.log(`privacy: ${Object.keys(run.metrics ?? {}).length} metrics, ${localIds.size} local-only ids, ${found.length} findings`);
  process.exit(found.length ? 1 : 0);
}
