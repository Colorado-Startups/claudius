// Code Project lines that only the machine's own files can answer, read in `--local` mode and never published
// (needs: local-files, tests/privacy.mjs). Every read is of a size, a count, a timestamp or a name field. A prompt,
// a reply, a tool result and a skill body are never kept, and the output holds numbers only: no path, no session id.
//
//   Thread starts, from this machine's session transcripts of the last params.window_days days (main sessions only):
//     cp_skills.skill_listing_tokens      the skill listing a session loads at start, characters / 4
//     cp_plugins.plugin_skill_tokens      the plugin-prefixed lines of that listing, characters / 4
//     cp_hooks.hook_text_tokens           text the start-of-session hooks add, characters / 4
//     cp_hooks.hook_ms                    median ms of a PreToolUse hook
//     cp_environment.thread_start_seconds median seconds from the first record to the first tool call
//     cp_work_locally.first_command_minutes median minutes from the first record to the first Bash call
//     cp_general.high_effort_share        sessions whose first reply ran above medium effort
//     cp_general.above_default_share      sessions whose first reply ran on a model above params.default_model
//     cp_environment.failed_servers       servers in params.needed_servers that the latest session's start lists as failed to connect
//   Folders:
//     cp_context.context_tokens           the Context tab files in params.context_dir, bytes / 4
//     cp_work_locally.folder_context_tokens  the largest of params.folder_dirs' CLAUDE.md and AGENTS.md, bytes / 4
//
// A metric with nothing to read is not measured and never 0 (Git Crafter quality/SCORING.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectMatch, redact, resolvePath, useLib } from '../lib/engine.mjs';
import { eachLine, mainSessions } from '../instructions/instructions-sessions.mjs';

export const area = 'cp-local';
export const metricIds = [
  'cp_skills.skill_listing_tokens',
  'cp_plugins.plugin_skill_tokens',
  'cp_hooks.hook_text_tokens',
  'cp_hooks.hook_ms',
  'cp_environment.thread_start_seconds',
  'cp_work_locally.first_command_minutes',
  'cp_general.high_effort_share',
  'cp_general.above_default_share',
  'cp_environment.failed_servers',
  'cp_context.context_tokens',
  'cp_work_locally.folder_context_tokens',
];

const TARGETS = ['code-project.json', 'code-project-tabs.json', 'code-project-features.json'].flatMap((f) => JSON.parse(fs.readFileSync(new URL(`../../targets/${f}`, import.meta.url), 'utf8')));
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const DEFINED = Object.fromEntries(TARGETS.map((t) => [t.id, t]));
const DAY = 864e5;
const HIGH = new Set(['high', 'xhigh', 'max']);
const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'];
const PLUGIN_LINE = /^- [\w.-]+:[\w.-]/;
// A line of the start text that lists a server which failed to connect: its name, an optional (code such as ERR_X, -32603 or 410), then a colon.
const FAILED_LINE = /^(\S+?)(?: \([^)]*\))?:(?: |$)/;
const tokens = (chars) => Math.ceil(chars / 4);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const round1 = (n) => Math.round(n * 10) / 10;
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : '')).join('\n') : '');
const family = (model) => FAMILIES.findIndex((f) => String(model ?? '').toLowerCase().includes(f));

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(gather(opts), opts.home);
}

// A record's `rendered` is a string, or a list of { content } messages.
const renderedText = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((m) => (typeof m === 'string' ? m : typeof m?.content === 'string' ? m.content : '')).join('\n') : '');

// The server names listed after "failed to connect" in a start text. Only names are kept, never the error text.
function failedServers(text, into) {
  let listing = false;
  for (const l of text.split('\n')) {
    if (/configured but failed to connect/.test(l)) {
      listing = true;
      continue;
    }
    if (!listing) continue;
    const m = FAILED_LINE.exec(l);
    if (m) into.add(m[1]);
    else listing = false;
  }
}

// What one session's first records say. Reads names, counts and lengths only.
export function readSession(file) {
  const s = { failed: new Set(), start: null, skills: null, pluginSkills: null, startText: 0, rendered: 0, begun: false, hookMs: [], firstTool: null, firstBash: null, effort: null, model: null };
  eachLine(file, (r) => {
    const at = Date.parse(r.timestamp);
    if (s.start === null && Number.isFinite(at)) s.start = at;
    const a = r.type === 'attachment' ? r.attachment : null;
    // The start of a session ends at its first reply or its first compaction: a SessionStart hook runs again on resume and compaction.
    if (r.type === 'assistant' || r.subtype === 'compact_boundary' || r.isCompactSummary) s.begun = true;
    if (a && r.rendered && !s.begun) {
      s.rendered += 1;
      failedServers(renderedText(r.rendered), s.failed);
    }
    if (a?.type === 'skill_listing' && s.skills === null) {
      const text = textOf(a.content);
      s.skills = tokens(text.length);
      s.pluginSkills = tokens(text.split('\n').filter((l) => PLUGIN_LINE.test(l)).join('\n').length);
    } else if (a?.type === 'hook_additional_context' && a.hookEvent === 'SessionStart') {
      if (!s.begun) s.startText += textOf(a.content).length;
    } else if ((a?.type === 'hook_success' || a?.type === 'hook_non_blocking_error') && a.hookEvent === 'PreToolUse' && Number.isFinite(a.durationMs)) {
      s.hookMs.push(a.durationMs);
    } else if (r.type === 'assistant') {
      if (s.model === null) {
        s.model = r.message?.model ?? r.requestedModel ?? null;
        s.effort = r.effort ?? r.perTurnEffort ?? null;
      }
      const calls = (Array.isArray(r.message?.content) ? r.message.content : []).filter((c) => c?.type === 'tool_use');
      if (calls.length && s.firstTool === null && Number.isFinite(at) && s.start !== null) s.firstTool = at - s.start;
      if (s.firstBash === null && Number.isFinite(at) && s.start !== null && calls.some((c) => c.name === 'Bash')) s.firstBash = at - s.start;
    }
  });
  return s;
}

function threadStarts(p, root, home, now, projectsDir) {
  const dir = projectsDir ?? resolvePath(p.projects_dir, { home, root });
  const match = String(p.project_match || projectMatch(root));
  if (!/[A-Za-z0-9]/.test(match)) return { why: `the project match "${match}" would read every project folder; set params.project_match` };
  let sessions;
  try {
    sessions = mainSessions(dir, match, p.subagents_dir, now).filter((x) => now - fs.statSync(x.file).mtimeMs <= p.window_days * DAY);
  } catch (err) {
    return { why: `could not read transcripts (${err.code ?? 'error'}); run where the sessions ran` };
  }
  if (!sessions.length) return { why: `no session transcript written in the last ${p.window_days} days in a folder naming ${match}` };
  return { rows: sessions.map((x) => readSession(x.file)) };
}

function dirBytes(dir, depth = 0) {
  let sum = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory() && depth < 4) sum += dirBytes(f, depth + 1);
    else if (e.isFile() && /\.(md|txt|json|ya?ml|csv|html?)$/i.test(e.name)) sum += fs.statSync(f).size;
  }
  return sum;
}

function gather({ params = {}, allParams = {}, root = '.', now = Date.now(), home = os.homedir(), projectsDir } = {}) {
  const p = { ...TEMPLATE, ...allParams['code-project.json'], ...allParams['code-project-tabs.json'], ...params };
  const out = {};
  const stamp = new Date(now).toISOString();
  const cnc = (id, why) => { out[id] = { could_not_check: why, source: DEFINED[id]?.source ?? id }; };
  const val = (id, value, detail, how) => { out[id] = { value, detail, source: `${DEFINED[id]?.source ?? id}; ${how}`, read_at: stamp }; };

  const starts = threadStarts(p, root, home, now, projectsDir);
  const withRows = (id, pick, unit, how, fn) => {
    if (!starts.rows) return cnc(id, starts.why);
    const xs = starts.rows.map(pick).filter((v) => v !== null && v !== undefined);
    if (!xs.length) return cnc(id, `no session in the window has this record (${how})`);
    const value = fn(xs);
    val(id, value, [{ label: `${xs.length} of ${starts.rows.length} sessions`, value, unit }], `${how}, ${xs.length} of ${starts.rows.length} sessions in the last ${p.window_days} days`);
  };
  withRows('cp_skills.skill_listing_tokens', (s) => s.skills, 'tokens', 'median of the listing characters / 4', (xs) => Math.round(median(xs)));
  withRows('cp_plugins.plugin_skill_tokens', (s) => s.pluginSkills, 'tokens', 'median of the plugin-prefixed listing lines, characters / 4', (xs) => Math.round(median(xs)));
  withRows('cp_hooks.hook_text_tokens', (s) => (s.skills === null ? null : tokens(s.startText)), 'tokens', 'median of the text start-of-session hooks add, characters / 4', (xs) => Math.round(median(xs)));
  if (starts.rows) {
    const all = starts.rows.flatMap((s) => s.hookMs);
    if (all.length) val('cp_hooks.hook_ms', Math.round(median(all)), [{ label: `${all.length} PreToolUse hook runs`, value: Math.round(median(all)), unit: 'ms' }], `median of ${all.length} PreToolUse hook runs`);
    else cnc('cp_hooks.hook_ms', 'no PreToolUse hook ran in the window');
  } else cnc('cp_hooks.hook_ms', starts.why);
  withRows('cp_environment.thread_start_seconds', (s) => s.firstTool, 's', 'median seconds from the first record to the first tool call', (xs) => round1(median(xs) / 1000));
  withRows('cp_work_locally.first_command_minutes', (s) => s.firstBash, 'min', 'median minutes from the first record to the first Bash call', (xs) => round1(median(xs) / 6e4));
  withRows('cp_general.high_effort_share', (s) => (s.effort ? Number(HIGH.has(s.effort)) : null), '%', 'share of sessions whose first reply ran above medium effort', (xs) => round1((100 * xs.reduce((a, b) => a + b, 0)) / xs.length));
  const latest = starts.rows ? [...starts.rows].sort((a, b) => (b.start ?? 0) - (a.start ?? 0))[0] : null;
  if (!latest) cnc('cp_environment.failed_servers', starts.why);
  else if (!Array.isArray(p.needed_servers) || !p.needed_servers.length) cnc('cp_environment.failed_servers', 'no needed_servers param: set it to the servers this project needs');
  else if (!latest.rendered) cnc('cp_environment.failed_servers', "the latest session's start has no tool listing record to read");
  else {
    const failed = p.needed_servers.filter((n) => latest.failed.has(n)).length;
    val('cp_environment.failed_servers', failed, [{ label: `of ${p.needed_servers.length} needed servers`, value: failed, unit: 'servers' }], "the servers of params.needed_servers named as failed to connect in the latest session's start text");
  }
  const base = family(p.default_model);
  withRows('cp_general.above_default_share', (s) => (family(s.model) < 0 || base < 0 ? null : Number(family(s.model) > base)), '%', `share of sessions whose first reply ran on a model above ${p.default_model}`, (xs) => round1((100 * xs.reduce((a, b) => a + b, 0)) / xs.length));

  const under = (d) => resolvePath(d, { home, root });
  const folder = (id, dir, how, fn) => {
    if (!dir || (Array.isArray(dir) && !dir.length)) return cnc(id, `no ${how.param} param: set it to the folder the machine holds`);
    const missing = [].concat(dir).filter((d) => !fs.existsSync(under(d)));
    if (missing.length) return cnc(id, `${how.param} names ${missing.length} folder${missing.length > 1 ? 's' : ''} that this machine does not have`);
    try { fn(); } catch { cnc(id, `could not read the ${how.param} folder on this machine`); }
  };
  folder('cp_context.context_tokens', p.context_dir, { param: 'context_dir' }, () => {
    const value = tokens(dirBytes(under(p.context_dir)));
    val('cp_context.context_tokens', value, [{ label: 'Context files', value, unit: 'tokens' }], 'text files under params.context_dir, bytes / 4');
  });
  folder('cp_work_locally.folder_context_tokens', p.folder_dirs, { param: 'folder_dirs' }, () => {
    const per = p.folder_dirs.map((d) => ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md'].reduce((n, f) => n + (fs.existsSync(path.join(under(d), f)) ? fs.statSync(path.join(under(d), f)).size : 0), 0));
    const value = tokens(Math.max(...per));
    val('cp_work_locally.folder_context_tokens', value, per.map((b, i) => ({ label: `folder ${i + 1}`, value: tokens(b), unit: 'tokens' })), 'the largest folder, its CLAUDE.md and AGENTS.md bytes / 4');
  });
  return out;
}
