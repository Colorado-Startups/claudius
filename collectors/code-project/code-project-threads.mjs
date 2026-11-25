// What the Code Project collector reads about a project's cloud threads (code-project.mjs):
//
//   code_project.draft_first_share      merged PRs from claude/ branches that opened as drafts (GitHub REST, public)
//   code_project.idle_revivals          sessions resumed after more than an hour idle, per week (local only)
//   code_project.tokens_per_merged_pr   the 4-week change in tokens per merged claude/ PR (local only)
//
// Privacy: the two local metrics read this account's own transcripts in `local` mode only and are dropped from
// the public page (needs local-files, tests/privacy.mjs). From a transcript record only timestamps, record
// types, the origin kind and token counts are read. The output holds counts and sums, never a prompt, a reply,
// a session id or a path.
import os from 'node:os';
import { ghClient, ownRepo, projectMatch, resolvePath } from '../lib/engine.mjs';
import { draftFirst, mergedByWeek, readMerged, threadPulls, withDraftState } from './code-project-pulls.mjs';
import { idleRevivals, weeklyTokens } from './code-project-transcripts.mjs';

const DRAFTS = 'code_project.draft_first_share';
const IDLE = 'code_project.idle_revivals';
const TOKENS = 'code_project.tokens_per_merged_pr';
const CI_REASON = 'transcripts live on the machine that ran the sessions; refreshed by a --local collect there';
const failure = (err) => String(err?.message ?? err).split('\n')[0].slice(0, 160);

// val(id, value, source, detail) and cnc(id, reason, source) write one metric into the collector's output.
export async function threadMetrics({ root, p, gh, mode, now, home = os.homedir(), projectsDir, val, cnc, count, listed }) {
  const pulls = await mergedPulls({ root, p, gh, count, listed });
  const mine = pulls.error ? [] : threadPulls(pulls.list, { prefix: p.branch_prefix, now });
  await draftMetric({ pulls, mine, p, now, count, val, cnc });
  if (mode !== 'local') {
    cnc(IDLE, CI_REASON);
    return cnc(TOKENS, CI_REASON);
  }
  const match = String(p.project_match || projectMatch(root));
  // A match with no letter or digit (a root of /) is in every folder's name.
  if (!/[A-Za-z0-9]/.test(match)) {
    const why = `the project match "${match}" would read every project folder; set params.project_match on targets/code-project.json`;
    cnc(IDLE, why);
    return cnc(TOKENS, why);
  }
  const dir = projectsDir ?? resolvePath(p.projects_dir, { home, root });
  localMetrics({ dir, match, p, now, pulls: pulls.error ? pulls : { list: mine }, val, cnc });
}

// The latest 100 merged PRs of this repo (from `listed`, the closed-PR list the caller already read, else one read), or the reason they could not be read.
async function mergedPulls({ root, p, gh, count, listed }) {
  try {
    const repo = p.repo || (await ownRepo(root, {}));
    if (!repo) return { error: 'no GitHub repo: set params.repo, or give the checkout a GitHub origin' };
    if (!listed) count?.();
    const client = gh ?? ghClient();
    return { list: await readMerged(client, repo, listed), client, repo };
  } catch (err) {
    return { error: `gh api failed: ${failure(err)}` };
  }
}

// The share of the latest p.max_prs thread PRs of the window that opened as drafts: one events read each.
async function draftMetric({ pulls, mine, p, now, count, val, cnc }) {
  if (pulls.error) return cnc(DRAFTS, pulls.error);
  const recent = mine.filter((pr) => now - Date.parse(pr.mergedAt) <= p.window_days * 864e5).slice(0, p.max_prs);
  if (!recent.length) return cnc(DRAFTS, `no PR from a ${p.branch_prefix} branch merged in the last ${p.window_days} days`);
  let got;
  try {
    got = draftFirst(await withDraftState(pulls.client, pulls.repo, recent, count));
  } catch (err) {
    return cnc(DRAFTS, `gh api failed: ${failure(err)}`);
  }
  val(DRAFTS, got.share, undefined, [
    { label: 'opened as drafts', value: got.drafts, unit: 'PRs' },
    { label: 'opened ready', value: got.total - got.drafts, unit: 'PRs' },
  ]);
}

function localMetrics({ dir, match, p, now, pulls, val, cnc }) {
  const common = { match, subagentsDir: p.subagents_dir, now };
  let revivals;
  let tokens;
  try {
    revivals = idleRevivals(dir, { ...common, humanOrigin: p.human_origin, idleMinutes: p.idle_minutes });
    tokens = weeklyTokens(dir, { ...common, weeks: p.weeks });
  } catch (err) {
    const why = `could not read transcripts (${err.code ?? failure(err)}); run where the sessions ran`;
    cnc(IDLE, why);
    return cnc(TOKENS, why);
  }
  if (revivals.sessions) {
    val(IDLE, revivals.revived.length, undefined, [{ label: 'resumed after an idle hour', value: revivals.revived.length, unit: 'revivals' }]);
  } else {
    cnc(IDLE, `no session transcript written in the last 7 days in a folder naming ${match}`);
  }
  if (tokens.sessions) tokenTrend({ tokens, pulls, p, now, val, cnc });
  else cnc(TOKENS, `no session transcript written in the last ${p.weeks} weeks in a folder naming ${match}`);
}

// The change in tokens per merged PR from the oldest week with both tokens and a merged PR to the latest.
function tokenTrend({ tokens, pulls, p, now, val, cnc }) {
  if (pulls.error) return cnc(TOKENS, pulls.error);
  const merged = mergedByWeek(pulls.list, { now, weeks: p.weeks });
  const rows = tokens.totals
    .map((t, i) => ({ label: `week ${i + 1} of ${p.weeks}${i === p.weeks - 1 ? ' (latest)' : ''}`, tokens: t, prs: merged[i] }))
    .map((r) => ({ ...r, per: r.prs && r.tokens ? Math.round(r.tokens / r.prs) : null }));
  const read = rows.filter((r) => r.per !== null);
  if (read.length < 2) return cnc(TOKENS, `fewer than two of the last ${p.weeks} weeks have both tokens and a merged ${p.branch_prefix} PR`);
  const change = Math.round(1000 * (read.at(-1).per / read[0].per - 1)) / 10;
  val(TOKENS, change, undefined, read.map((r) => ({ label: r.label, value: r.per, unit: 'tokens per PR' })));
}
