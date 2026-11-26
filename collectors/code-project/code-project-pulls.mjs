// What the Claude Code Projects collector reads from GitHub: the merged pull requests of the threads'
// branches, whether each opened as a draft, and the week each merged in (code-project.mjs).

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number headRefName createdAt mergedAt
        timelineItems(first: 5, itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) {
          nodes { __typename ... on ReadyForReviewEvent { createdAt } ... on ConvertToDraftEvent { createdAt } }
        } }
    }
  }
}`;

const DAY = 864e5;

// The latest 100 merged PRs of a repo, as GitHub returns them. gh: a github-core client (graphql).
export async function readMerged(gh, repo) {
  const [owner, name] = repo.split('/');
  const data = await gh.graphql(QUERY, { owner, name });
  return data?.repository?.pullRequests?.nodes ?? [];
}

// A merged PR cannot be a draft, so it opened as one only when its first draft event is "ready for review";
// one whose first is "convert to draft", or with none, opened ready.
export function openedAsDraft(pr) {
  const events = [...(pr.timelineItems?.nodes ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return events[0]?.__typename === 'ReadyForReviewEvent';
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
  const drafts = pulls.filter(openedAsDraft).length;
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
