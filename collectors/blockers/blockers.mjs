// Blockers tab collector: every restriction on how Claude works in this repo,
// priced in quality, speed and tokens, so what gets in the way can be removed.
//
// A blocker is anything that stops, slows or adds to a session's work: a hook
// (a retired guard's rule in old transcripts too), a permission check, a git hook, a file loaded
// on every call, the pinned review loop and the wait for CI. Each is one row
// of the ledger (blockers.costly): fires, false-alarm share, hours and tokens
// over the last LAST_CALLS tool calls (the review loop and CI over the last
// LAST_PRS merged PRs), and a verdict (verdict(), below). The other metrics
// sum the rows by kind.
//
// Privacy: transcripts are read in `local` mode only, from
// this account's own ~/.claude. A CI run reads GitHub alone, for the metrics
// marked needs gh. Prompts and replies are never read. Commands,
// file paths and tool results are read in memory to classify a block or match
// a retry, and never leave this module.
// The output holds counts, durations, token sums, and rule, hook and file
// names. Instruction files are sized with stat and never opened.
//
// A block held only when no similar call succeeded in the same transcript
// within RETRY_MS, or when every similar call that succeeded there ran only
// the blocked command's own steps, as typed, steps that apply the fix the
// block named (a command its rule's params.fix_signals lists) and write no
// file, and neutral steps: an allowlisted read or print whose every flag is on
// its list (neutralStep()). Anything else is a false alarm: a step of its own
// (the block misfired, or was routed around), a veto, or essentially the same
// call run unblocked.
// Ambiguities read as false alarm. For Bash, the same command is the
// same segments(), flags kept; for any other tool,
// the same input. A block whose call cannot be read is left out and
// counted. A block's time runs from the
// blocked call to the transcript's next call, at most RETRY_MS. Its tokens are
// the model call that read the block and answered it, in full; blocks refused
// together share that call.
//
// Point in time: every metric is over the last N events, new work replacing
// old within hours, never a calendar window. Blocks, hooks and the
// ledger: the last LAST_CALLS tool calls in this repo's transcripts, rates per
// PER tool calls. Hook output: the last LAST_SESSIONS main sessions.
// git commit and push: the last LAST_GIT of each. Reviews, CI and the revert
// breaker: the last LAST_PRS merged PRs. Each target's source says why each N.
//
// Contract: quality/targets/blockers.json lists every metric id. collect()
// returns each one as a value or as { could_not_check }, never throws for a
// missing tool, token or file, and never turns "could not read" into 0.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { managedClaudeMd, ownRepo, PROJECTS_DIR, projectMatch, resolvePath, ruleLoadsAlways } from '../claude/claude.mjs';
import { CI_REASON, GITHUB_IDS, LAST_PRS, TEMPLATE, attempt, defaultExec, defaultGh, firstLine, metricIds } from './blockers-core.mjs';
import { fixSignals } from './blockers-neutral.mjs';
import { readTranscripts } from './blockers-transcripts.mjs';
import { graphql, readLater, readMerged } from './blockers-github.mjs';
import { computeMetrics } from './blockers-metrics.mjs';
import { redact, useLib } from '../lib/engine.mjs';

export { area, metricIds } from './blockers-core.mjs';
export { classifyBlock } from './blockers-transcripts.mjs';
export { gitKind, outputTargets, sameCall, segments, similar, steps, words } from './blockers-shell.mjs';
export { fixSignals, neutralStep, writesFile } from './blockers-neutral.mjs';
export { outcomeOf, signalForm } from './blockers-outcome.mjs';
export { ENFORCEMENT, pushes, reviewRounds, verdict } from './blockers-github.mjs';

// One run's settings, from params, each defaulting to what the repo's own
// root and platform say:
//   projects_dir     where transcripts live; default ~/.claude/projects
//   project_match    the folders there to read; default projectMatch(root)
//                    in claude.mjs
//   repo             owner/name; default ownRepo() in claude.mjs
//   reviewer         the GitHub login whose reviews are the pinned review
//                    loop; default any reviewer
//   managed_claude_md  default the platform's managed policy CLAUDE.md
//   enforcement_paths  the paths the revert breaker watches
//   fix_signals      rule id to regexes: the commands that apply its fix
export function config(params, root) {
  const match = String(params.project_match || projectMatch(root));
  const projects = String(params.projects_dir || PROJECTS_DIR);
  return {
    match,
    projects,
    transcripts: `${projects}/*${match}*/**/*.jsonl`,
    reviewer: String(params.reviewer ?? ''),
    managed: String(params.managed_claude_md || managedClaudeMd()),
    enforcement: (params.enforcement_paths ?? []).map((re) => new RegExp(re)),
    fixes: fixSignals(params.fix_signals),
  };
}

// Every metric of this tab, with each home path and account name taken out
// of the text (redact.mjs).
export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(await gather(opts), opts.home);
}

async function gather({
  root = '.',
  mode,
  projectsDir,
  home = os.homedir(),
  gh = defaultGh,
  exec = defaultExec,
  now = new Date(),
  managedPath,
  params = TEMPLATE,
} = {}) {
  const all = (reason, source) => Object.fromEntries(metricIds.map((id) => [id, { could_not_check: reason, source }]));
  const p = params;
  const cfg = config(p, root);
  const local = mode === 'local';
  // A match with no letter or digit (a root of /) is in every folder's name.
  if (local && !/[A-Za-z0-9]/.test(cfg.match)) return all(`the project match "${cfg.match}" would read every project folder; set params.project_match on quality/targets/blockers.json`, cfg.transcripts);
  cfg.repo = await ownRepo(root, p, exec);
  if (!cfg.repo) return all('no GitHub repo: set params.repo on quality/targets/blockers.json, or give the checkout a GitHub origin', cfg.transcripts);
  const nowMs = now.getTime();
  // In CI only the metrics marked needs gh are read, from GitHub with the workflow token; every other one
  // lives on the machine that ran the sessions, and nothing on this machine is read.
  if (!local) {
    const none = { error: CI_REASON };
    const got = computeMetrics({ files: none, instructions: none, github: await readGithub(cfg.repo, gh, nowMs), now: nowMs, readAt: now.toISOString(), cfg });
    return { ...all(CI_REASON, cfg.transcripts), ...Object.fromEntries(GITHUB_IDS.map((id) => [id, got[id]])) };
  }
  const dir = projectsDir ?? resolvePath(cfg.projects, { home, root });
  const files = attempt(() => readTranscripts(dir, cfg));
  const instructions = attempt(() => sizeInstructions({ root, home, managedPath: managedPath ?? cfg.managed, projectsDir: dir, match: cfg.match }));
  const github = await readGithub(cfg.repo, gh, nowMs);
  return computeMetrics({ files, instructions, github, now: nowMs, readAt: now.toISOString(), cfg });
}

// The last merged PRs and what came after them, the reverts and bug issues; a failed read is its error.
async function readGithub(repo, gh, nowMs) {
  let github;
  try {
    github = { prs: await readMerged(repo, gh, nowMs) };
    try {
      const last = github.prs.slice(0, LAST_PRS);
      github.later = await readLater(repo, gh, Math.min(...last.map((pr) => Date.parse(pr.mergedAt)), nowMs));
    } catch (err) {
      github.laterError = `gh pr list or gh issue list failed (${firstLine(err)})`;
    }
  } catch (err) {
    github = { error: `gh api graphql failed (${firstLine(err)})` };
  }
  return github;
}

// ----------------------------------------------------------- instructions

// Files every session of this repo loads on every call, by stat (and a rule's
// frontmatter keys: one scoped by paths is left out). A file that
// does not exist is not loaded; any other error means none could be sized.
function sizeInstructions({ root, home, managedPath, projectsDir, match }) {
  const rules = path.join(home, '.claude', 'rules');
  const list = [
    ['repo CLAUDE.md', path.join(root, 'CLAUDE.md')],
    ['managed CLAUDE.md', managedPath],
    ['user CLAUDE.md', path.join(home, '.claude', 'CLAUDE.md')],
    ...(fs.existsSync(rules) ? fs.readdirSync(rules).filter((f) => f.endsWith('.md') && ruleLoadsAlways(path.join(rules, f))).sort().map((f) => [`rules/${f}`, path.join(rules, f)]) : []),
    ...fs
      .readdirSync(projectsDir)
      .filter((d) => d.endsWith(match))
      .map((d) => ['memory index', path.join(projectsDir, d, 'memory', 'MEMORY.md')]),
  ];
  const files = [];
  for (const [label, p] of list) {
    try {
      files.push({ label, tokens: Math.ceil(fs.statSync(p).size / 4) });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return { files };
}

