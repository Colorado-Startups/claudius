// Visibility tab: which repos of a GitHub org are public or private, and what each side shows.
//   Quality: private repos with a public page; public repos without secret scanning; personal emails in public history.
//   Speed: seconds per audit. Consumption: gh api requests per audit.
// Reads gh api only, plus one signed-out request per private repo's site. Org: params.owner, else this repo's owner.
// A personal account answers orgs/<owner> with 404: it is read through users/<owner> and user/repos instead.
// A state read now; of each public repo, every commit of every branch, each list read to its last page.
// A token that cannot count every private repo, or hides security_and_analysis, leaves that metric not measured,
// never 0 (Git Crafter quality/SCORING.md); in CI that waits for ADMIN_READ_TOKEN (actions/pages admin-read-token).
// Privacy: detail rows name public repos only; an email is counted, never kept.
import fs from 'node:fs';
import { ghClient, ownRepo, redact, useLib } from '../lib/engine.mjs';
import { ghFailed } from '../lib/gh-failure.mjs';

export const area = 'visibility';

const TARGETS = JSON.parse(fs.readFileSync(new URL('../../targets/visibility.json', import.meta.url), 'utf8'));
export const metricIds = TARGETS.map((t) => t.id);
const TEMPLATE = Object.assign({}, ...TARGETS.map((t) => t.params ?? {}));
const SOURCE = 'quality/collectors/visibility/visibility.mjs';
const NOREPLY = /(@users\.noreply\.github\.com|^noreply@github\.com)$/i;
// Authors that are tools, not people: Claude Code cloud sessions commit as this address. Override with params.bot_emails.
const BOT_EMAILS = ['noreply@anthropic.com'];

export async function collect(opts = {}) {
  useLib(opts.lib);
  return redact(await gather(opts), opts.home);
}

// An author email that is neither GitHub's noreply, one of params.bot_emails, nor at one of params.org_domains.
export const personal = (email, orgDomains = [], botEmails = BOT_EMAILS) => {
  const e = String(email ?? '').trim().toLowerCase();
  return Boolean(e) && !NOREPLY.test(e) && !botEmails.some((b) => e === String(b).trim().toLowerCase()) && !orgDomains.some((d) => e.endsWith(`@${String(d).toLowerCase()}`));
};

async function gather({ root = '.', mode, params = TEMPLATE, gh, fetchPage = signedOut, env = process.env } = {}) {
  const started = Date.now();
  const readAt = new Date().toISOString();
  const owner = String(params.owner || (await ownRepo(root, {})).split('/')[0] || '');
  const all = (reason) => Object.fromEntries(metricIds.map((id) => [id, { could_not_check: reason, source: SOURCE }]));
  if (!owner) return all('no org to read: set params.owner on quality/targets/visibility.json');
  const admin = mode === 'ci' ? String(env.ADMIN_READ_TOKEN ?? '').trim() : '';
  const client = gh ?? ghClient(admin || undefined);
  let requests = 0;
  const rest = (route) => (requests += 1, client.rest(route));
  // Every page of a list, each page one request.
  const restAll = (route) => client.restAll(route).then((list) => ((requests += Math.max(1, Math.ceil(list.length / 100))), list), (err) => ((requests += 1), Promise.reject(err)));
  const out = {};
  const val = (id, value, source, detail) => (out[id] = { value, ...(detail?.length ? { detail } : {}), source, read_at: readAt });
  const cnc = (id, reason, source) => (out[id] = { could_not_check: reason, source });
  let org, repos, user = false;
  try {
    org = await rest(`orgs/${owner}`);
    repos = await restAll(`orgs/${owner}/repos?per_page=100&type=all`);
  } catch (err) {
    if (!notFound(err)) return all(ghFailed(`gh api orgs/${owner}`, err));
    // Not an org: a personal account. Its repos are the signed-in user's own; any other owner's are not listed.
    try {
      org = await rest(`users/${owner}`);
      repos = (await restAll('user/repos?per_page=100&affiliation=owner')).filter((r) => String(r.owner?.login ?? '').toLowerCase() === owner.toLowerCase());
      user = true;
    } catch (err2) {
      return all(`${ghFailed(`gh api orgs/${owner}`, err)}; ${ghFailed(`gh api users/${owner}`, err2)}`);
    }
  }
  const pub = repos.filter((r) => r.visibility === 'public');
  const priv = repos.filter((r) => r.visibility !== 'public');

  // Probe: a private repo's site, public in its Pages setting or loading for a signed-out request.
  const pagesSource = `gh api orgs/${owner}/repos, then repos/<repo>/pages of each private repo with a site (public true) and one signed-out request to its html_url (a 2xx not on github.com); a count, never a name`;
  // A personal account counts its private repos under total_private_repos, or owned_private_repos; either is hidden from other logins.
  const total = typeof org.total_private_repos === 'number' ? org.total_private_repos : user ? org.owned_private_repos : undefined;
  if (typeof total !== 'number') cnc('visibility.private_public_pages', `this token cannot count the ${user ? 'account' : 'org'}'s private repos (${user ? 'users' : 'orgs'}/<owner> hides total_private_repos)`, pagesSource);
  else if (priv.length < total) cnc('visibility.private_public_pages', `this token sees ${priv.length} of the ${user ? 'account' : 'org'}'s ${total} private repos`, pagesSource);
  else {
    try {
      const open = (await Promise.all(priv.filter((x) => x.has_pages).map(async (r) => {
        const site = await rest(`repos/${r.full_name}/pages`).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
        return Boolean(site && (site.public === true || (site.html_url && (await fetchPage(site.html_url)))));
      }))).filter(Boolean).length;
      val('visibility.private_public_pages', open, `${pagesSource}; ${priv.length} private repos`);
    } catch (err) {
      cnc('visibility.private_public_pages', ghFailed('gh api repos/<repo>/pages or the request to its site', err), pagesSource);
    }
  }

  // Decide: a public repo stays public only with secret scanning and push protection on. Archived ones take no push.
  const scanSource = `security_and_analysis of each public, unarchived repo in gh api orgs/${owner}/repos: secret scanning and push protection both enabled`;
  // user/repos, and a list read without admin rights, omit security_and_analysis; repos/<repo> returns it to an admin.
  const live = await Promise.all(pub.filter((r) => !r.archived).map(async (r) => (r.security_and_analysis ? r : { ...r, ...(await rest(`repos/${r.full_name}`).then((one) => ({ security_and_analysis: one?.security_and_analysis }), () => ({}))) })));
  if (live.some((r) => !r.security_and_analysis)) cnc('visibility.public_without_secret_scanning', 'gh api answered without security_and_analysis: needs an admin token; refreshed by a --local collect run', scanSource);
  else {
    const off = live.filter((r) => ['secret_scanning', 'secret_scanning_push_protection'].some((k) => r.security_and_analysis[k]?.status !== 'enabled'));
    val('visibility.public_without_secret_scanning', off.length, `${scanSource}; ${live.length} repos`, off.map((r) => ({ label: r.name, value: 1, unit: 'repos' })));
  }

  // Scan: personal author emails in every commit of every branch of every public repo. Forks keep a copy whatever
  // is rewritten. One repo at a time and four branches at a time, clear of GitHub's secondary rate limits.
  // A personal profile's own site or email is a personal address, so only an org's profile domains are exempt.
  const domains = [...(params.org_domains ?? []), ...(user ? [] : orgDomains(org))];
  const bots = params.bot_emails ?? BOT_EMAILS;
  const emailSource = `gh api --paginate repos/<repo>/branches, then every commit of each branch, every page, of every public repo, one repo and four branches at a time; distinct author emails neither GitHub noreply, nor in params.bot_emails, nor at params.org_domains or an org profile's site or email domain; counts only`;
  try {
    const hit = [];
    for (const r of pub) {
      const branches = await restAll(`repos/${r.full_name}/branches?per_page=100`);
      const mine = new Set();
      for (let i = 0; i < branches.length; i += 4) {
        const lists = await Promise.all(branches.slice(i, i + 4).map((b) => restAll(`repos/${r.full_name}/commits?sha=${encodeURIComponent(b.name)}&per_page=100`).catch((err) => (err.status === 409 ? [] : Promise.reject(err)))));
        for (const c of lists.flat()) if (personal(c.commit?.author?.email, domains, bots)) mine.add(c.commit.author.email.toLowerCase());
      }
      if (mine.size) hit.push({ r, mine });
    }
    const seen = new Set(hit.flatMap((f) => [...f.mine]));
    const detail = hit.map((f) => ({ label: f.r.name, value: f.mine.size, unit: 'emails' }));
    const forks = hit.reduce((sum, f) => sum + (f.r.forks_count ?? 0), 0);
    if (detail.length) detail.push({ label: 'forks holding a copy', value: forks, unit: 'forks' });
    val('visibility.personal_author_emails', seen.size, `${emailSource}; ${pub.length} public repos`, detail);
  } catch (err) {
    cnc('visibility.personal_author_emails', ghFailed('gh api repos/<repo>/branches or commits', err), emailSource);
  }

  val('visibility.audit_seconds', Math.round((Date.now() - started) / 100) / 10, `wall time of this collector, from the org read to the last commit read; ${repos.length} repos this token sees`);
  val('visibility.requests', requests, `gh api requests this collector made, one per page; ${repos.length} repos this token sees`);
  return Object.fromEntries(metricIds.map((id) => [id, out[id] ?? { could_not_check: 'collector produced no value', source: SOURCE }]));
}

// True when a page loads for a request with no credentials: a 2xx that did not land on a github.com sign-in.
async function signedOut(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  return res.ok && !/(^|\.)github\.com$/.test(new URL(res.url || url).hostname);
}

// The org profile's own domains: its site's host and its public email's domain.
const orgDomains = (org) => [org.blog && /^https?:\/\//.test(org.blog) ? new URL(org.blog).hostname.replace(/^www\./, '') : '', String(org.email ?? '').split('@')[1] ?? ''].filter(Boolean);

const notFound = (err) => err?.status === 404 || /\b404\b|not found/i.test(String(err?.message ?? ''));
