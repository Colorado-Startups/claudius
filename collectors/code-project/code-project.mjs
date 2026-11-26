// Code Project tab: is a repo ready for the cloud threads of a Claude Code Project?
//   Quality: guard rules a thread reads, instruction length, read-only subagents that can edit.
//   Speed: minutes from a claude/ branch's first commit to its pull request, hours from that PR to merge.
//   Consumption: subagents with no model, gh api requests per run.
//   Parts (code-project-parts.mjs): one group per project part, read from repo files.
//   Threads (code-project-threads.mjs): PRs opened as drafts, sessions revived after an idle hour, tokens per merged PR.
// Reads repo files, and gh api for the last 30 days of merged claude/ pull requests. A cloud thread skips a repo's
// settings.json permissions, hooks and env, so a guard it must obey sits in CLAUDE.md or AGENTS.md (Claude Code docs,
// claude-projects, read 2026-11-26). A metric with nothing to read is not measured, never 0 (Git Crafter quality/SCORING.md).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ghClient, ownRepo, percentile, redact, useLib } from '../lib/engine.mjs';
import { partMetrics } from './code-project-parts.mjs';
import { threadMetrics } from './code-project-threads.mjs';

export const area = 'code-project';
// Reads the GitHub API: collect.mjs skips it under the API reserve (ci.json params.api_reserve).
export const githubApi = true;

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/code-project.json', import.meta.url), 'utf8'));
export const metricIds = TARGETS.map((t) => t.id);
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const SOURCE = 'quality/collectors/code-project/code-project.mjs';
const WRITE_TOOLS = /\b(Edit|Write|MultiEdit|NotebookEdit)\b/;

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(await gather(opts), opts.home);
}

const read = (root, file) => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
};

// The front matter of an agent file as { key: value }, plus its body.
export function parseAgent(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { front: {}, body: text };
  const front = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { front, body: m[2] };
}

const agentFiles = (root, dirs) => dirs.flatMap((dir) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').map((f) => ({ file: `${dir}/${f}`, ...parseAgent(fs.readFileSync(path.join(abs, f), 'utf8')) }));
});

// A read only agent that can write: it says read only and lists a writing tool, or lists no tools and so inherits every
// one unless its disallowedTools names each writing one (Claude Code docs, sub-agents, read 2026-11-26).
const WRITERS = ['Edit', 'Write', 'NotebookEdit'];
export const unsafeAgent = ({ front, body }) => {
  if (!/read[- ]only/i.test(`${front.description ?? ''}\n${body}`)) return false;
  if (front.tools) return WRITE_TOOLS.test(front.tools);
  return !WRITERS.every((t) => new RegExp(`\\b${t}\\b`).test(front.disallowedTools ?? ''));
};

const median = (list) => (list.length ? Math.round(percentile(list, 0.5) * 10) / 10 : null);

async function gather({ root = '.', params = TEMPLATE, gh, now = Date.now(), mode, home = os.homedir(), projectsDir } = {}) {
  const readAt = new Date(now).toISOString();
  const out = {};
  const sourceOf = (id) => TARGETS.find((t) => t.id === id)?.source ?? SOURCE;
  const val = (id, value, source = sourceOf(id), detail) => (out[id] = { value, ...(detail?.length ? { detail } : {}), source, read_at: readAt });
  const cnc = (id, reason, source = sourceOf(id)) => (out[id] = { could_not_check: reason, source });

  // Guards: each rule a thread must obey is said in a file it reads.
  const files = (params.instruction_files ?? []).map((f) => ({ f, text: read(root, f) })).filter((x) => x.text !== null);
  const guardSource = `params.rules, each a regular expression, matched case-insensitively against ${(params.instruction_files ?? []).join(', ')}; a missing rule is listed by its label`;
  if (!files.length) {
    cnc('code_project.guard_rules_missing', `none of ${(params.instruction_files ?? []).join(', ')} exists`, guardSource);
    cnc('code_project.instruction_lines', 'no instruction file to count', guardSource);
  } else {
    const all = files.map((x) => x.text).join('\n');
    const missing = (params.rules ?? []).filter((r) => !new RegExp(r.pattern, 'i').test(all));
    val('code_project.guard_rules_missing', missing.length, guardSource, missing.map((r) => ({ label: r.label, value: 1, unit: 'rules' })));
    const longest = files.reduce((a, b) => (b.text.split('\n').length > a.text.split('\n').length ? b : a));
    val('code_project.instruction_lines', longest.text.replace(/\n$/, '').split('\n').length, `lines of the longest of ${files.map((x) => x.f).join(', ')}; Claude Code docs, memory, target under 200 lines per CLAUDE.md`, files.map((x) => ({ label: x.f, value: x.text.replace(/\n$/, '').split('\n').length, unit: 'lines' })));
  }

  // Subagents: read only means no write tool; every agent names its model, so none inherits the parent's.
  const agents = agentFiles(root, params.agent_dirs ?? []);
  const agentSource = `agent files in ${(params.agent_dirs ?? []).join(', ')}: front matter tools and model, and whether the text says read only`;
  if (!agents.length) {
    cnc('code_project.agents_unsafe', 'no agent files to read', agentSource);
    cnc('code_project.agents_without_model', 'no agent files to read', agentSource);
  } else {
    const bad = agents.filter(unsafeAgent);
    val('code_project.agents_unsafe', bad.length, `${agentSource}; ${agents.length} files`, bad.map((a) => ({ label: a.file, value: 1, unit: 'agents' })));
    const bare = agents.filter((a) => !a.front.model);
    val('code_project.agents_without_model', bare.length, `${agentSource}; ${agents.length} files`, bare.map((a) => ({ label: a.file, value: 1, unit: 'agents' })));
  }

  // Threads: merged pull requests from a claude/ branch in the window.
  const prSource = `gh api repos/<repo>/pulls?state=closed, merged ${params.window_days} days or fewer ago from a branch starting ${params.branch_prefix}; first commit time from repos/<repo>/pulls/<n>/commits (at most ${params.max_prs} pull requests)`;
  let requests = 0;
  const speedIds = ['code_project.draft_pr_minutes', 'code_project.ready_to_merge_hours'];
  try {
    const repo = params.repo || (await ownRepo(root, {}));
    if (!repo) throw new Error('no repo to read: set params.repo on quality/targets/code-project.json');
    const client = gh ?? ghClient();
    const rest = (route) => (requests += 1, client.rest(route));
    const since = now - params.window_days * 86400000;
    const pulls = (await rest(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`))
      .filter((p) => p.merged_at && Date.parse(p.merged_at) >= since && String(p.head?.ref ?? '').startsWith(params.branch_prefix))
      .slice(0, params.max_prs);
    if (!pulls.length) {
      for (const id of speedIds) cnc(id, `no ${params.branch_prefix} pull request merged in ${params.window_days} days`, prSource);
    } else {
      const firsts = [];
      for (const p of pulls) {
        const commits = await rest(`repos/${repo}/pulls/${p.number}/commits?per_page=1`);
        const at = Date.parse(commits[0]?.commit?.author?.date ?? '');
        if (Number.isFinite(at)) firsts.push((Date.parse(p.created_at) - at) / 60000);
      }
      const minutes = median(firsts.map((m) => Math.max(0, m)));
      if (minutes === null) cnc(speedIds[0], 'no first commit time was readable', prSource);
      else val(speedIds[0], minutes, `${prSource}; median of ${firsts.length}`);
      val(speedIds[1], median(pulls.map((p) => (Date.parse(p.merged_at) - Date.parse(p.created_at)) / 3600000)), `${prSource}; median of ${pulls.length}`);
    }
  } catch (err) {
    for (const id of speedIds) if (!out[id]) cnc(id, firstLine(err), prSource);
  }
  partMetrics({ root, params: { ...TEMPLATE, ...params }, val, cnc });
  await threadMetrics({ root, p: { ...TEMPLATE, ...params }, gh, mode, now, home, projectsDir, val, cnc, count: () => (requests += 1) });
  val('code_project.requests', requests, 'gh api requests this collector made, one per route');
  return Object.fromEntries(metricIds.map((id) => [id, out[id] ?? { could_not_check: 'collector produced no value', source: SOURCE }]));
}

const firstLine = (err) => String(err?.message || err).trim().split('\n')[0].slice(0, 160);
