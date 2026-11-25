// What the Claude Code Projects collector reads from GitHub: the merged pull requests of the threads'
// branches, whether each opened as a draft, and the week each merged in (code-project-threads.mjs).
// REST only (repos/<repo>/pulls and repos/<repo>/issues/<n>/events), so a cloud thread, which GitHub refuses
// GraphQL, reads it as well as CI and a Mac do.

const DAY = 864e5;

// The route of the latest 100 closed PRs by update: the one list both halves of the collector read.
export const closedPullsRoute = (repo) => `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`;

// The latest 100 merged PRs of a repo by update, as { number, headRefName, createdAt, mergedAt }.
// gh: a github-core client (rest); listed: that route's answer when the caller already holds it.
export async function readMerged(gh, repo, listed) {
  return (listed ?? (await gh.rest(closedPullsRoute(repo))))
    .filter((p) => p.merged_at)
    .map((p) => ({ number: p.number, headRefName: p.head?.ref, createdAt: p.created_at, mergedAt: p.merged_at }));
}

// A merged PR cannot be a draft, so it opened as one only when the first of its ready_for_review and
// convert_to_draft events is ready_for_review; one whose first is convert_to_draft, or with none, opened ready.
// events: the issue events of the PR, as repos/<repo>/issues/<n>/events returns them.
export function openedAsDraft(events) {
  const drafts = [...(events ?? [])]
    .filter((e) => e.event === 'ready_for_review' || e.event === 'convert_to_draft')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return drafts[0]?.event === 'ready_for_review';
}

// Each PR with `draft` set from its own issue events, one read each.
export async function withDraftState(gh, repo, pulls, count) {
  const out = [];
  for (const p of pulls) {
    count?.();
    out.push({ ...p, draft: openedAsDraft(await gh.rest(`repos/${repo}/issues/${p.number}/events?per_page=100`)) });
  }
  return out;
}

// The merged PRs from a thread's branch, newest first, merged within the last `days` days when given.
export function threadPulls(pulls, { prefix, now, days = Infinity }) {
  return pulls
    .filter((p) => String(p.headRefName ?? '').startsWith(prefix) && Date.parse(p.mergedAt) <= now && now - Date.parse(p.mergedAt) <= days * DAY)
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));
}

// The share of those PRs that opened as drafts, and the counts; null when there are none.
export function draftFirst(pulls) {
  if (!pulls.length) return null;
  const drafts = pulls.filter((p) => p.draft).length;
  return { share: Math.round((1000 * drafts) / pulls.length) / 10, drafts, total: pulls.length };
}

// The PRs merged in each of `weeks` 7-day buckets ending at now: index 0 is the oldest, weeks - 1 the latest.
export function mergedByWeek(pulls, { now, weeks }) {
  const counts = Array(weeks).fill(0);
  for (const p of pulls) {
    const age = Math.floor((now - Date.parse(p.mergedAt)) / (7 * DAY));
    if (age >= 0 && age < weeks) counts[weeks - 1 - age] += 1;
  }
  return counts;
}
