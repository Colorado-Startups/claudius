// Best practices: how close a repo's plugins and skills are to Anthropic's directory review and its
// skill authoring rules. Every metric but Docs reads the repo's own files, so CI and the public page
// measure it too; no metric needs local files.
//
//   Directory  the developer portal's checks on each plugin folder, one row per rule in
//              practices-rules.mjs, counted by result: blocks, holds, warnings
//   Listing    the directory listing fields each plugin.json leaves out
//   Skills     the authoring rules on each SKILL.md: names and descriptions, size and layout, tools
//   Cost       the largest plugin's always-on tokens: skill, command and agent names and descriptions
//   Evals      plugin skills with fewer than three claude plugin eval cases that prove they fired,
//              and those whose cases do not beat no plugin in every model's report
//   Docs       hook events and settings keys the live Claude Code docs and this pack's lists
//              disagree on, read when the page builds (docs-drift.mjs)
//
// Files: git ls-files -s, or a walk of the folder less params.skip_dirs outside git. A plugin folder
// holds .claude-plugin/plugin.json; it and the repo's .claude/skills are looked for outside
// params.skip_dirs. With no plugin folder the plugin rows are not measured and .claude/skills still
// score. A part that cannot be read is could_not_check, never 0. The output names files and rules,
// never a file's text.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { redact, useLib } from '../lib/engine.mjs';
import { LISTS, drift, readDocs } from './docs-drift.mjs';
import { DIRECTORY_RULES, SKILL_RULES } from './practices-rules.mjs';

export const area = 'practices';

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/practices.json', import.meta.url), 'utf8'));
export const metricIds = TARGETS.map((t) => t.id);
// The template's own params, merged as the engine merges a file's: the defaults for a bare call.
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const SOURCE = 'collectors/practices/practices.mjs';
const DRIFT = 'collectors/practices/docs-drift.mjs';
export const NO_PLUGIN = 'no .claude-plugin/plugin.json';
const PLUGIN_ROWS = ['directory_blocks', 'directory_holds', 'directory_warnings', 'listing_fields_missing', 'listing_tokens', 'skills_under_three_evals', 'skills_without_lift'];
const LISTING_FIELDS = ['icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl', 'displayName', 'keywords', 'homepage'];
const RULES = Object.fromEntries([...DIRECTORY_RULES, ...SKILL_RULES].map((r) => [r.id, r]));
const P = path.posix;
const run = promisify(execFile);
const isObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const join = (dir, f) => (dir ? `${dir}/${f}` : f);
const firstLine = (err) => String(err?.stderr || err?.message || err).trim().split('\n')[0].slice(0, 160);

// Every metric of this tab, with each home path and account name taken out of the text (redact.mjs).
export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(await gather(opts), opts.home);
}

async function gather({ root = '.', params = TEMPLATE, now = new Date(), docs = readDocs } = {}) {
  const readAt = now.toISOString();
  const out = {};
  const val = (k, value, source, detail = []) => (out[`practices.${k}`] = { value, ...(detail.length ? { detail } : {}), source, read_at: readAt });
  const cnc = (k, reason, source) => (out[`practices.${k}`] = { could_not_check: reason, source });
  // The pack's own lists against the live docs, whatever the repo holds (docs-drift.mjs).
  try {
    const hits = drift(await docs());
    val('docs_drift', hits.length, `${DRIFT}: ${LISTS.map((l) => `${l.list} at ${l.url}`).join(', ')}`, hits.map((h) => ({ label: `${h.list}: ${h.name}, ${h.side}`, value: 1, unit: 'names' })));
  } catch (err) {
    cnc('docs_drift', `could not read the docs (${firstLine(err)})`, DRIFT);
  }
  let a;
  try {
    a = await audit({ root, params });
  } catch (err) {
    for (const k of metricIds) out[k] ??= { could_not_check: `could not list the repo's files (${firstLine(err)})`, source: SOURCE };
    return out;
  }
  const { how, plugins, skills, findings } = a;
  const src = (what) => `${SOURCE}: ${what}; files from ${how}`;
  const rows = (hits) => hits.map((f) => ({ label: `${f.file}: ${RULES[f.rule].title}${f.note ? ` (${f.note})` : ''}, ${RULES[f.rule].doc}`, value: 1, unit: 'findings' }));

  for (const metric of ['skill_rules', 'skill_size', 'skill_tools_unnamed']) {
    const hits = findings.filter((f) => f.metric === metric);
    val(metric, hits.length, src(`${skills.length} skills in plugins and .claude/skills, each ${metric} row of practices-rules.mjs`), rows(hits));
  }
  if (!plugins.length) {
    for (const k of PLUGIN_ROWS) cnc(k, NO_PLUGIN, src('no plugin folder'));
    return out;
  }
  const folders = `${plugins.length} plugin folders (${plugins.map((p) => p.dir || '.').join(', ')})`;
  for (const [metric, result] of [['directory_blocks', 'blocks'], ['directory_holds', 'holds'], ['directory_warnings', 'warning']]) {
    const hits = findings.filter((f) => f.result === result);
    val(metric, hits.length, src(`${folders}, each ${result} row of practices-rules.mjs`), rows(hits));
  }

  const readable = plugins.filter((p) => p.manifest);
  if (!readable.length) cnc('listing_fields_missing', 'no plugin.json parses', src(folders));
  else {
    const gaps = readable.map((p) => [p, LISTING_FIELDS.filter((k) => !listed(p, k))]).filter(([, ks]) => ks.length);
    val('listing_fields_missing', gaps.reduce((n, [, ks]) => n + ks.length, 0), src(`${readable.length} plugin.json files`), gaps.map(([p, ks]) => ({ label: `${p.manifestFile}: ${ks.join(', ')}`, value: ks.length, unit: 'fields' })));
  }

  const cost = plugins.map((p) => ({ p, parts: p.components.map((c) => ({ label: `${p.name}/${c.listName}`, chars: c.listChars })) }));
  const totals = cost.map(({ parts }) => Math.round(parts.reduce((n, c) => n + c.chars, 0) / 4));
  val('listing_tokens', Math.max(...totals), src(`${folders}: name, description and when_to_use characters over 4`), cost.flatMap(({ parts }) => parts.map((c) => ({ label: c.label, value: Math.round(c.chars / 4), unit: 'tokens' }))).sort((x, y) => y.value - x.value));

  const pluginSkills = (p) => skills.filter((s) => s.plugin === p);
  const proving = new Map(plugins.flatMap((p) => { const cases = evalCases(a.repo, p); return pluginSkills(p).map((s) => [s, [...cases].filter(([, gs]) => gs.some((g) => proves(g, p.name, s.folder))).map(([name]) => name)]); }));
  const few = [...proving].filter(([, names]) => names.length < 3);
  val('skills_under_three_evals', few.length, src(`${proving.size} plugin skills, cases in <plugin>/evals/*/ with a tool_used Skill grader`), few.map(([s, names]) => ({ label: `${s.plugin.name}:${s.folder}`, value: names.length, unit: 'cases' })));

  try {
    const templates = list(params.eval_reports ?? TEMPLATE.eval_reports);
    const lacking = [];
    for (const p of plugins) {
      const reports = templates.map((t) => readReport(root, String(t).replaceAll('<plugin>', p.name)));
      for (const s of pluginSkills(p)) {
        const names = new Set(proving.get(s));
        const why = reports.flatMap((r) => {
          if (r.why) return [`${r.rel} ${r.why}`];
          const deltas = r.cases.filter((c) => names.has(c?.name) && Number.isFinite(c?.aggregates?.delta)).map((c) => c.aggregates.delta);
          if (!deltas.length) return [`${r.rel} has no case of it with a delta`];
          const mean = deltas.reduce((n, d) => n + d, 0) / deltas.length;
          return mean > 0 ? [] : [`${r.rel} mean delta ${mean.toFixed(2)}`];
        });
        if (why.length) lacking.push({ label: `${p.name}:${s.folder}: ${why.join('; ')}`, value: 1, unit: 'skills' });
      }
    }
    val('skills_without_lift', lacking.length, src(`${proving.size} plugin skills, mean cases[].aggregates.delta in each of ${templates.join(', ')}`), lacking);
  } catch (err) {
    cnc('skills_without_lift', err.message, src('params.eval_reports'));
  }
  return Object.fromEntries(metricIds.map((k) => [k, out[k] ?? { could_not_check: 'collector produced no value', source: SOURCE }]));
}

// One model's claude plugin eval report: its cases, or why it shows no lift. One that does not parse throws.
function readReport(root, rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return { rel, why: 'is missing' };
  let r;
  try {
    r = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`could not read ${rel} (${firstLine(err)})`);
  }
  if (r?.schemaVersion !== undefined && r.schemaVersion !== 1) throw new Error(`${rel} has schemaVersion ${r.schemaVersion}, not 1`);
  if (r?.partial === true) return { rel, why: 'partial, left out' };
  return { rel, cases: Array.isArray(r?.cases) ? r.cases : [] };
}

// A listing field set in the form the directory reads.
function listed(p, k) {
  const v = p.manifest[k];
  if (k === 'icon') return typeof v === 'string' && /\.(png|jpe?g|gif|webp|svg)$/i.test(v) && p.files.includes(p.inside(v));
  if (k === 'keywords') return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim());
  if (k === 'displayName') return typeof v === 'string' && Boolean(v.trim());
  try {
    return typeof v === 'string' && (k === 'homepage' ? /^https?:$/ : /^https:$/).test(new URL(v).protocol);
  } catch {
    return false;
  }
}

// Each case folder <plugin>/evals/<case>/ with a prompt.md or case.yaml, and its graders' frontmatter.
function evalCases(repo, p) {
  const base = join(p.dir, 'evals');
  const parts = p.files.filter((f) => f.startsWith(`${base}/`)).map((f) => f.slice(base.length + 1).split('/'));
  const cases = new Map(parts.filter((s) => s.length === 2 && ['prompt.md', 'case.yaml'].includes(s[1])).map((s) => [s[0], []]));
  for (const s of parts) if (s.length === 3 && s[1] === 'graders' && s[2].endsWith('.md') && cases.has(s[0])) cases.get(s[0]).push(parseFrontmatter(repo.read(`${base}/${s.join('/')}`) ?? '').fields);
  return cases;
}

// A grader that proves the skill fired: tool_used on Skill, its input_match matching the call. The
// regex comes from the repo, a pull request's included: one over 300 characters, or with a quantified
// group that holds a quantifier ((a+)+), could backtrack for hours, so it proves nothing.
const NESTED = /\([^()]*[+*}][^()]*\)[+*{]/;
function proves(g, plugin, skill) {
  if (g.type !== 'tool_used' || g.tool !== 'Skill' || typeof g.input_match !== 'string') return false;
  if (g.input_match.length > 300 || NESTED.test(g.input_match)) return false;
  try {
    return new RegExp(g.input_match).test(`"skill": "${plugin}:${skill}"`);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ the repo

// The repo, its plugins, its skills, and every rule's findings: [{ rule, result | metric, file, note }].
export async function audit({ root = '.', params = TEMPLATE } = {}) {
  const skip = list(params.skip_dirs ?? TEMPLATE.skip_dirs);
  const { how, entries } = await listFiles(root, skip);
  const repo = makeRepo(root, entries);
  const MANIFEST = '.claude-plugin/plugin.json';
  const dirs = [...repo.modes.keys()].filter((f) => (f === MANIFEST || f.endsWith(`/${MANIFEST}`)) && !under(f, skip)).map((f) => f.slice(0, -MANIFEST.length).replace(/\/$/, ''));
  repo.plugins = dirs.sort().map((dir) => buildPlugin(repo, dir));
  repo.skills = [
    ...repo.plugins.flatMap((p) => p.components.filter((c) => c.kind === 'skill').map((c) => skillOf(repo, c, p))),
    ...[...repo.modes.keys()].filter((f) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f) && !under(f, skip)).map((f) => skillOf(repo, { file: f, fm: parseFrontmatter(repo.read(f) ?? '') }, null)),
  ];
  const findings = [
    ...DIRECTORY_RULES.flatMap((r) => r.check(repo).map((f) => ({ rule: r.id, result: r.result, ...f }))),
    ...SKILL_RULES.flatMap((r) => repo.skills.flatMap((s) => r.check(s, repo).map((f) => ({ rule: r.id, metric: r.metric, ...f })))),
  ];
  return { how, plugins: repo.plugins, skills: repo.skills, findings, repo };
}

// True when a path is in a skipped folder: a prefix of it equals a skip_dirs entry or ends with one.
function under(f, skip) {
  const parts = f.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const pre = parts.slice(0, i).join('/');
    if (skip.some((d) => pre === d || pre.endsWith(`/${d}`))) return true;
  }
  return false;
}

// [{ path, mode }]: git's index with its modes (120000 a link, 160000 a submodule), else a walk.
async function listFiles(root, skip) {
  try {
    const { stdout } = await run('git', ['-C', root, 'ls-files', '-s', '-z'], { maxBuffer: 512 * 1024 * 1024 });
    const seen = new Map();
    for (const rec of stdout.split('\0')) {
      const m = /^(\d{6}) [0-9a-f]+ \d\t([\s\S]+)$/.exec(rec);
      if (m && !seen.has(m[2])) seen.set(m[2], m[1]);
    }
    if (seen.size) return { how: 'git ls-files -s', entries: [...seen].map(([p, mode]) => ({ path: p, mode })) };
  } catch {
    // Not a git checkout, or no git: walk the folder instead.
  }
  return { how: `a walk less ${skip.join(', ')}`, entries: walk(root, '', skip) };
}

function walk(root, rel, skip) {
  const out = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const f = join(rel, d.name);
    if (d.name === '.git' || under(f, skip)) continue;
    if (d.isSymbolicLink()) out.push({ path: f, mode: '120000' });
    else if (d.isDirectory()) {
      if (fs.existsSync(path.join(root, f, '.git'))) out.push({ path: f, mode: '160000' });
      else out.push(...walk(root, f, skip));
    } else if (d.isFile()) out.push({ path: f, mode: fs.statSync(path.join(root, f)).mode & 0o111 ? '100755' : '100644' });
  }
  return out;
}

// What every rule reads: each listed path's mode, the folders above them, and each file's bytes,
// text and size, read once. A link, a submodule or a path git lists but the disk lacks reads as null.
function makeRepo(root, entries) {
  const modes = new Map(entries.map((e) => [e.path, e.mode]));
  const dirs = new Set();
  for (const f of modes.keys()) for (let d = P.dirname(f); d !== '.' && !dirs.has(d); d = P.dirname(d)) dirs.add(d);
  const cache = { buf: new Map(), text: new Map(), size: new Map() };
  const abs = (f) => path.join(root, ...f.split('/'));
  const once = (map, f, read) => {
    if (!map.has(f)) {
      try {
        map.set(f, read());
      } catch {
        map.set(f, null);
      }
    }
    return map.get(f);
  };
  const regular = (f) => ['100644', '100755'].includes(modes.get(f));
  const buffer = (f) => (regular(f) ? once(cache.buf, f, () => fs.readFileSync(abs(f))) : null);
  return {
    root,
    modes,
    paths: [...modes.keys(), ...dirs],
    mode: (f) => modes.get(f),
    isDir: (f) => dirs.has(f),
    buffer,
    read: (f) => once(cache.text, f, () => buffer(f)?.toString('utf8') ?? null),
    size: (f) => once(cache.size, f, () => fs.lstatSync(abs(f)).size),
  };
}

// One plugin folder: its files, manifest, hooks, MCP servers, the commands they run, and its skills,
// commands and agents. A manifest path that leaves the folder is not followed (path_climbs counts it).
function buildPlugin(repo, dir) {
  const at = (r) => {
    const f = P.normalize(join(dir, r)).replace(/\/$/, '');
    return f === '.' ? '' : f;
  };
  const files = [...repo.modes.keys()].filter((f) => !dir || f.startsWith(`${dir}/`));
  const has = new Set(files);
  const inside = (r) => {
    if (typeof r !== 'string' || P.isAbsolute(r) || /(^|\/)\.\.(\/|$)/.test(r)) return null;
    return at(r);
  };
  const manifestFile = at('.claude-plugin/plugin.json');
  let manifest = null;
  let manifestError = null;
  try {
    const m = JSON.parse(repo.read(manifestFile) ?? '');
    if (!isObject(m)) manifestError = 'not a JSON object';
    else if (typeof m.name !== 'string' || !m.name.trim()) manifestError = 'no name';
    else manifest = m;
  } catch (err) {
    manifestError = `does not parse (${firstLine(err)})`;
  }
  const p = { dir, at, rel: (f) => (dir ? f.slice(dir.length + 1) : f), inside, files, manifestFile, manifest, manifestError, name: manifest?.name ?? P.basename(dir || path.resolve(repo.root)) };
  const jsonFile = (f) => {
    const t = repo.read(f);
    if (t === null) return { file: f, error: 'cannot be read' };
    try {
      return { file: f, data: JSON.parse(t) };
    } catch (err) {
      return { file: f, error: `does not parse (${firstLine(err)})` };
    }
  };

  const hookFiles = [...new Set([has.has(at('hooks/hooks.json')) ? at('hooks/hooks.json') : null, ...list(manifest?.hooks).filter((h) => typeof h === 'string').map(inside)].filter((f) => f !== null))];
  p.hookSources = [...hookFiles.map(jsonFile), ...list(manifest?.hooks).filter(isObject).map((h) => ({ file: manifestFile, data: { hooks: h } }))];
  const hooks = p.hookSources.filter((s) => isObject(s.data?.hooks)).flatMap((s) => Object.entries(s.data.hooks).flatMap(([event, ms]) => list(ms).flatMap((m) => list(m?.hooks)).filter(isObject).map((h) => ({ file: s.file, event, ...h }))));

  p.mcpFiles = [];
  p.servers = [];
  p.bundles = [];
  const addMap = (file, map) => Object.entries(map).forEach(([name, cfg]) => p.servers.push({ file, name, cfg }));
  const addMcp = (f) => {
    const j = jsonFile(f);
    const map = isObject(j.data?.mcpServers) ? j.data.mcpServers : j.data;
    if (j.error || !isObject(map)) return p.mcpFiles.push({ file: f, error: j.error ?? 'not a JSON object' });
    p.mcpFiles.push({ file: f });
    addMap(f, map);
  };
  if (has.has(at('.mcp.json'))) addMcp(at('.mcp.json'));
  for (const m of list(manifest?.mcpServers)) {
    if (typeof m === 'string' && /\.(mcpb|dxt)$/i.test(m)) p.bundles.push({ file: manifestFile, ref: m });
    else if (typeof m === 'string' && !/^https?:\/\//.test(m) && inside(m) !== null) addMcp(inside(m));
    else if (isObject(m)) addMap(manifestFile, m);
  }

  const command = (file, cmd, args) => ({ file, text: [cmd, ...args].join(' '), tokens: [...tokenize(cmd), ...args.map(String)] });
  p.commands = [
    ...hooks.filter((h) => (h.type ?? 'command') === 'command' && typeof h.command === 'string').map((h) => command(h.file, h.command, list(h.args))),
    ...p.servers.filter((s) => typeof s.cfg?.command === 'string').map((s) => command(s.file, s.cfg.command, list(s.cfg.args))),
  ];
  p.components = components(repo, p, inside, has);
  return p;
}

// The plugin's skills, commands and agents, each with its frontmatter and its always-on name and text.
function components(repo, p, inside, has) {
  const out = [];
  const under = (d) => p.files.filter((f) => !d || f.startsWith(`${d}/`));
  const add = (kind, file, name, described) => {
    const t = repo.read(file);
    if (t === null) return;
    const fm = parseFrontmatter(t);
    const f = fm.ok ? fm.fields : {};
    const listName = typeof f.name === 'string' && kind !== 'command' ? f.name : name;
    const text = [listName, typeof f.description === 'string' ? f.description : (described ?? ''), typeof f.when_to_use === 'string' ? f.when_to_use : ''];
    out.push({ kind, file, fm, described: typeof described === 'string', listName, listChars: text.join('').length });
  };
  const m = p.manifest ?? {};
  const skillDirs = [p.at('skills'), ...list(m.skills).map(inside).filter((d) => d !== null)];
  const skillFiles = new Set();
  for (const d of skillDirs) {
    if (d !== p.at('skills') && has.has(join(d, 'SKILL.md'))) skillFiles.add(join(d, 'SKILL.md'));
    for (const f of under(d)) if (/^[^/]+\/SKILL\.md$/.test(d ? f.slice(d.length + 1) : f)) skillFiles.add(f);
  }
  if (!skillFiles.size && m.skills === undefined && has.has(join(p.dir, 'SKILL.md'))) skillFiles.add(join(p.dir, 'SKILL.md'));
  for (const f of [...skillFiles].sort()) add('skill', f, P.basename(P.dirname(f)));

  const md = (f) => f.endsWith('.md');
  if (isObject(m.commands)) {
    for (const [name, v] of Object.entries(m.commands)) {
      if (typeof v?.source === 'string' && inside(v.source) !== null) add('command', inside(v.source), name, v.description);
      else out.push({ kind: 'command', file: null, fm: { has: true, ok: true, fields: {} }, described: true, listName: name, listChars: name.length + String(v?.description ?? '').length });
    }
  } else {
    const paths = m.commands !== undefined ? list(m.commands).map(inside).filter((d) => d !== null) : [p.at('commands')];
    for (const d of paths) for (const f of md(d) ? [d].filter((x) => has.has(x)) : under(d).filter(md)) add('command', f, P.basename(f, '.md'));
  }
  const agents = m.agents !== undefined ? list(m.agents).map(inside).filter((f) => f !== null && has.has(f)) : under(p.at('agents')).filter(md);
  for (const f of agents) add('agent', f, P.basename(f, '.md'));
  return out;
}

function skillOf(repo, c, plugin) {
  const dir = P.dirname(c.file);
  return { file: c.file, dir, folder: P.basename(dir), plugin, fm: c.fm, fields: c.fm.ok ? c.fm.fields : {}, body: c.fm.has ? c.fm.body : (repo.read(c.file) ?? ''), files: [...repo.modes.keys()].filter((f) => f.startsWith(`${dir}/`)) };
}

// A command line as a shell splits it: quotes and escapes taken out, | || && ; & as their own tokens.
export function tokenize(s) {
  const out = [];
  let cur = '';
  let open = false;
  let quote = null;
  const push = () => {
    if (open) out.push(cur);
    cur = '';
    open = false;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch === '\\' && quote === '"' && i + 1 < s.length ? s[++i] : ch;
    } else if (ch === '"' || ch === "'") [quote, open] = [ch, true];
    else if (ch === '\\' && i + 1 < s.length) [cur, open] = [cur + s[++i], true];
    else if (/\s/.test(ch)) push();
    else if (['&&', '||'].includes(s.slice(i, i + 2))) {
      push();
      out.push(s.slice(i, ++i + 1));
    } else if ('|;&'.includes(ch)) {
      push();
      out.push(ch);
    } else [cur, open] = [cur + ch, true];
  }
  push();
  return out;
}

// --------------------------------------------------------------- frontmatter

// YAML frontmatter as a strict reader of the subset skills use: { has, ok, error?, fields, body }.
// It refuses what a YAML parser refuses: an unclosed quote or bracket, a plain value holding ": ",
// a tab in an indent, a key twice, a line that is not key: value.
export function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  if (!/^---[ \t]*\r?\n/.test(src)) return { has: false, ok: true, fields: {}, body: src };
  const lines = src.split(/\r?\n/);
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) return { has: true, ok: false, error: 'no closing ---', fields: {}, body: '' };
  const body = lines.slice(end + 1).join('\n');
  try {
    return { has: true, ok: true, fields: yamlMap(lines.slice(1, end)), body };
  } catch (err) {
    return { has: true, ok: false, error: err.message, fields: {}, body };
  }
}

const KEY = /^([A-Za-z0-9_$][\w$.-]*)[ \t]*:(?:[ \t]+(.*))?$/;
const blank = (l) => !l.trim() || /^\s*#/.test(l);

function yamlMap(lines) {
  const out = {};
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }
    if (/^[ \t]/.test(line)) throw new Error(`line ${i + 2} is indented under no key`);
    const m = KEY.exec(line);
    if (!m) throw new Error(`line ${i + 2} is not key: value`);
    if (Object.hasOwn(out, m[1])) throw new Error(`key ${m[1]} appears twice`);
    const raw = (m[2] ?? '').trim();
    let j = i + 1;
    while (j < lines.length && (blank(lines[j]) || /^[ \t]/.test(lines[j]) || (!raw && /^-(\s|$)/.test(lines[j])))) j++;
    const block = lines.slice(i + 1, j);
    if (block.some((l) => /^ *\t/.test(l) && l.trim())) throw new Error(`line ${i + 2}: a tab in an indent`);
    out[m[1]] = value(raw, block, i + 2);
    i = j;
  }
  return out;
}

function value(raw, block, n) {
  const rest = block.filter((l) => !blank(l));
  if (/^[>|][+-]?\d*$/.test(raw)) return raw[0] === '>' ? block.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim() : block.map((l) => l.replace(/^\s+/, '')).join('\n').replace(/\n+$/, '');
  if (raw) return scalar([raw, ...rest.map((l) => l.trim())].join(' '), n);
  if (!rest.length) return null;
  const indent = Math.min(...rest.map((l) => l.match(/^ */)[0].length));
  const top = rest.filter((l) => l.match(/^ */)[0].length === indent).map((l) => l.trim());
  if (top.every((l) => /^-(\s|$)/.test(l))) {
    return top.map((l) => {
      const item = l.replace(/^-\s*/, '');
      const kv = KEY.exec(item);
      return kv && !/^["'[{]/.test(item) ? { [kv[1]]: kv[2] === undefined ? null : scalar(kv[2].trim(), n) } : scalar(item, n);
    });
  }
  return Object.fromEntries(top.map((l) => {
    const kv = KEY.exec(l);
    if (!kv) throw new Error(`line ${n}: ${l.slice(0, 40)} is not key: value`);
    return [kv[1], kv[2] === undefined ? null : scalar(kv[2].trim(), n)];
  }));
}

function scalar(s, n) {
  if (s.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/.exec(s);
    if (!m) throw new Error(`line ${n}: a double-quoted value is not closed`);
    return m[1].replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e) => (e[0] === 'u' ? String.fromCharCode(parseInt(e.slice(1), 16)) : ({ n: '\n', t: '\t', r: '\r', 0: '\0' })[e] ?? e));
  }
  if (s.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'\s*(#.*)?$/.exec(s);
    if (!m) throw new Error(`line ${n}: a single-quoted value is not closed`);
    return m[1].replace(/''/g, "'");
  }
  if (s.startsWith('[') || s.startsWith('{')) {
    const close = s[0] === '[' ? ']' : '}';
    if (!new RegExp(`\\${close}\\s*(#.*)?$`).test(s)) throw new Error(`line ${n}: a ${s[0]} is not closed`);
    const items = flowItems(s.slice(1, s.lastIndexOf(close)));
    if (close === ']') return items.map((x) => scalar(x, n));
    return Object.fromEntries(items.map((x) => {
      const kv = /^([^:]+):\s*(.*)$/.exec(x);
      if (!kv) throw new Error(`line ${n}: ${x} is not key: value`);
      return [kv[1].trim().replace(/^["']|["']$/g, ''), kv[2] ? scalar(kv[2], n) : null];
    }));
  }
  const p = s.replace(/\s+#.*$/, '').trim();
  if (/:(\s|$)/.test(p)) throw new Error(`line ${n}: a plain value holds ": "; quote it`);
  if (/^[@`%|>]/.test(p)) throw new Error(`line ${n}: a plain value cannot start with ${p[0]}`);
  if (/^(true|false)$/i.test(p)) return p.toLowerCase() === 'true';
  if (/^(null|~)$/i.test(p) || !p) return null;
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(p)) return Number(p);
  return p;
}

// A flow collection's items, split on commas outside quotes and brackets.
function flowItems(s) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of s) {
    if (quote) quote = ch === quote ? null : quote;
    else if (ch === '"' || ch === "'") quote = ch;
    else if ('[{'.includes(ch)) depth++;
    else if (']}'.includes(ch)) depth--;
    else if (ch === ',' && !depth) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
