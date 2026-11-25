// Claude Code Projects tab collector: what a project's cloud threads cost and how their pull requests open.
// Git Crafter's pull_requests, issues and projects metrics already score a PR's health, so this tab adds only:
//
//   code_projects.draft_first_share      merged PRs from claude/ branches that opened as drafts (GitHub, public)
//   code_projects.idle_revivals          sessions resumed after more than an hour idle, per week (local only)
//   code_projects.tokens_per_merged_pr   the 4-week change in tokens per merged claude/ PR (local only)
//
// Every name and N is a param on targets/code-projects.json.
//
// Privacy: the two local metrics read this account's own transcripts in `local` mode only and are dropped from
// the public page (needs local-files, tests/privacy.mjs). From a transcript record only timestamps, record
// types, the origin kind and token counts are read. The output holds counts and sums, never a prompt, a reply,
// a session id or a path.
//
// Contract: collect() returns every id in the targets file, each a value or { could_not_check }; it never
// throws for a missing tool, token or file, and never turns "could not read" into 0.

import fs from 'node:fs';
import os from 'node:os';
import { ownRepo, projectMatch, resolvePath } from '../claude/claude.mjs';
import { ghClient, redact, useLib } from '../lib/engine.mjs';
import { draftFirst, mergedByWeek, readMerged, threadPulls } from './code-projects-pulls.mjs';
import { idleRevivals, weeklyTokens } from './code-projects-transcripts.mjs';

export const area = 'code_projects';
// Reads the GitHub API: collect.mjs skips it under the API reserve (ci.json params.api_reserve).
export const githubApi = true;

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/code-projects.json', import.meta.url), 'utf8'));
export const metricIds = TARGETS.map((t) => t.id);
// The template's own params, merged as the engine merges a file's: the defaults for a bare call.
export const PARAMS = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));

const ID = Object.fromEntries(metricIds.map((id) => [id.split('.')[1], id]));
const CI_REASON = 'transcripts live on the machine that ran the sessions; refreshed by a --local collect there';
const sourceOf = (id) => TARGETS.find((t) => t.id === id).source;
const failure = (err) => String(err?.message ?? err).split('\n')[0].slice(0, 160);

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(await gather(opts), opts.home);
}

async function gather({ root = '.', mode, params: given = PARAMS, gh, now = new Date(), home = os.homedir(), projectsDir } = {}) {
  const p = { ...PARAMS, ...given };
  const at = now.getTime();
  const readAt = now.toISOString();
  const out = {};
  const cnc = (key, reason) => {
    out[ID[key]] = { could_not_check: reason, source: sourceOf(ID[key]) };
  };
  const val = (key, value, detail) => {
    out[ID[key]] = { value, detail, source: sourceOf(ID[key]), read_at: readAt };
  };

  const pulls = await mergedPulls({ root, p, gh });
  const mine = pulls.error ? [] : threadPulls(pulls.list, { prefix: p.branch_prefix, now: at });
  pullMetric({ pulls, mine, p, at, cnc, val });
  if (mode !== 'local') {
    cnc('idle_revivals', CI_REASON);
    cnc('tokens_per_merged_pr', CI_REASON);
    return out;
  }
  const match = String(p.project_match || projectMatch(root));
  // A match with no letter or digit (a root of /) is in every folder's name.
  if (!/[A-Za-z0-9]/.test(match)) {
    const why = `the project match "${match}" would read every project folder; set params.project_match on targets/code-projects.json`;
    cnc('idle_revivals', why);
    cnc('tokens_per_merged_pr', why);
    return out;
  }
  const dir = projectsDir ?? resolvePath(p.projects_dir, { home, root });
  localMetrics({ dir, match, p, at, pulls: pulls.error ? pulls : { list: mine }, cnc, val });
  return out;
}

// The latest 100 merged PRs of this repo, or the reason they could not be read.
async function mergedPulls({ root, p, gh }) {
  try {
    const repo = await ownRepo(root, p);
    if (!repo) return { error: 'no GitHub repo: set params.repo, or give the checkout a GitHub origin' };
    return { list: await readMerged(gh ?? ghClient(), repo) };
  } catch (err) {
    return { error: `gh api graphql failed: ${failure(err)}` };
  }
}

function pullMetric({ pulls, mine, p, at, cnc, val }) {
  if (pulls.error) return cnc('draft_first_share', pulls.error);
  const recent = mine.filter((pr) => at - Date.parse(pr.mergedAt) <= p.window_days * 864e5);
  const got = draftFirst(recent);
  if (!got) return cnc('draft_first_share', `no PR from a ${p.branch_prefix} branch merged in the last ${p.window_days} days`);
  val('draft_first_share', got.share, [
    { label: 'opened as drafts', value: got.drafts, unit: 'PRs' },
    { label: 'opened ready', value: got.total - got.drafts, unit: 'PRs' },
  ]);
}

function localMetrics({ dir, match, p, at, pulls, cnc, val }) {
  const common = { match, subagentsDir: p.subagents_dir, now: at };
  let revivals;
  let tokens;
  try {
    revivals = idleRevivals(dir, { ...common, humanOrigin: p.human_origin, idleMinutes: p.idle_minutes });
    tokens = weeklyTokens(dir, { ...common, weeks: p.weeks });
  } catch (err) {
    const why = `could not read transcripts (${err.code ?? failure(err)}); run where the sessions ran`;
    cnc('idle_revivals', why);
    return cnc('tokens_per_merged_pr', why);
  }
  if (!revivals.sessions) {
    const why = `no session transcript in a folder naming ${match}`;
    cnc('idle_revivals', why);
    return cnc('tokens_per_merged_pr', why);
  }
  val('idle_revivals', revivals.revived.length, [{ label: 'resumed after an idle hour', value: revivals.revived.length, unit: 'sessions' }]);
  tokenTrend({ tokens, pulls, p, at, cnc, val });
}

// The change in tokens per merged PR from the oldest week with both tokens and a merged PR to the latest.
function tokenTrend({ tokens, pulls, p, at, cnc, val }) {
  if (pulls.error) return cnc('tokens_per_merged_pr', pulls.error);
  const merged = mergedByWeek(pulls.list, { now: at, weeks: p.weeks });
  const rows = tokens.totals.map((t, i) => ({ label: `week ${i + 1} of ${p.weeks}${i === p.weeks - 1 ? ' (latest)' : ''}`, tokens: t, prs: merged[i] })).map((r) => ({ ...r, per: r.prs && r.tokens ? Math.round(r.tokens / r.prs) : null }));
  const read = rows.filter((r) => r.per !== null);
  if (read.length < 2) return cnc('tokens_per_merged_pr', `fewer than two of the last ${p.weeks} weeks have both tokens and a merged ${p.branch_prefix} PR`);
  const change = Math.round((1000 * (read.at(-1).per / read[0].per - 1))) / 10;
  val('tokens_per_merged_pr', change, rows.filter((r) => r.per !== null).map((r) => ({ label: r.label, value: r.per, unit: 'tokens per PR' })));
}
