// node --test collectors/visibility/visibility.test.mjs
// Every input is synthetic: an org of four repos answered by a fake gh client, and a fake signed-out fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { area, collect, metricIds, personal } from './visibility.mjs';

const on = { status: 'enabled' };
const sa = (push = on) => ({ secret_scanning: on, secret_scanning_push_protection: push });
const REPOS = [
  { name: 'site', full_name: 'acme/site', visibility: 'public', archived: false, forks_count: 2, security_and_analysis: sa() },
  { name: 'tools', full_name: 'acme/tools', visibility: 'public', archived: false, forks_count: 0, security_and_analysis: sa({ status: 'disabled' }) },
  { name: 'vault', full_name: 'acme/vault', visibility: 'private', has_pages: true },
  { name: 'notes', full_name: 'acme/notes', visibility: 'private', has_pages: true, archived: true },
];
const commit = (email) => ({ commit: { author: { email } } });
const ROUTES = {
  'orgs/acme': { total_private_repos: 2, blog: 'https://www.acme.example' },
  'repos/acme/vault/pages': { public: false, html_url: 'https://acme.github.io/vault/' },
  'repos/acme/notes/pages': { public: true, html_url: 'https://acme.github.io/notes/' },
  'repos/acme/site/branches?per_page=100': [{ name: 'main' }, { name: 'feat/x' }],
  'repos/acme/site/commits?sha=main&per_page=100': [commit('1+a@users.noreply.github.com'), commit('Dev@Home.example')],
  'repos/acme/site/commits?sha=feat%2Fx&per_page=100': [commit('dev@home.example'), commit('ops@acme.example'), commit('noreply@github.com')],
  'repos/acme/tools/branches?per_page=100': [],
};
function fakeGh({ repos = REPOS, routes = ROUTES } = {}) {
  const rest = async (route) => {
    if (route in routes) return structuredClone(routes[route]);
    throw Object.assign(new Error(`HTTP 404: ${route}`), { status: 404 });
  };
  return { rest, restAll: async (route) => (route.startsWith('orgs/') ? structuredClone(repos) : rest(route)) };
}
const params = { owner: 'acme', org_domains: [] };
const run = (opts = {}) => collect({ params, gh: fakeGh(opts), fetchPage: async () => false, ...opts });

test('visibility: every metric of the targets file, read from one org', async () => {
  assert.equal(area, 'visibility');
  const out = await run();
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  assert.equal(out['visibility.private_public_pages'].value, 1, 'the archived private repo whose site is set public');
  assert.equal(out['visibility.public_without_secret_scanning'].value, 1);
  assert.deepEqual(out['visibility.public_without_secret_scanning'].detail, [{ label: 'tools', value: 1, unit: 'repos' }]);
  assert.equal(out['visibility.personal_author_emails'].value, 1, 'one address, case folded, found on a second branch too');
  assert.deepEqual(out['visibility.personal_author_emails'].detail, [{ label: 'site', value: 1, unit: 'emails' }, { label: 'forks holding a copy', value: 2, unit: 'forks' }]);
  assert.equal(out['visibility.requests'].value, 8, 'org, list, two Pages reads, two branch lists, two commit reads');
  assert.ok(out['visibility.audit_seconds'].value >= 0);
  assert.ok(!JSON.stringify(out).includes('home.example') && !/vault|notes/.test(JSON.stringify(out)), 'no address, no private name');
});

test('visibility: every page of a branch is read, each page one request', async () => {
  const long = [...Array(150)].map(() => commit('1+a@users.noreply.github.com')).concat(commit('late@home.example'));
  const out = await run({ routes: { ...ROUTES, 'repos/acme/tools/branches?per_page=100': [{ name: 'main' }], 'repos/acme/tools/commits?sha=main&per_page=100': long } });
  assert.equal(out['visibility.personal_author_emails'].value, 2, 'the address in commit 151 counts');
  assert.equal(out['visibility.requests'].value, 10, 'two pages for that branch');
});

test('visibility: a page that loads signed out counts, though its setting says private', async () => {
  const out = await run({ fetchPage: async (url) => url.includes('vault') });
  assert.equal(out['visibility.private_public_pages'].value, 2);
});

test('visibility: a token that cannot see every private repo, or security_and_analysis, leaves those not measured, never 0', async () => {
  const short = await run({ routes: { ...ROUTES, 'orgs/acme': { total_private_repos: 5 } } });
  assert.match(short['visibility.private_public_pages'].could_not_check, /sees 2 of the org's 5/);
  const hidden = await run({ routes: { ...ROUTES, 'orgs/acme': { blog: 'https://www.acme.example' } }, repos: REPOS.map(({ security_and_analysis, ...r }) => r) });
  assert.match(hidden['visibility.private_public_pages'].could_not_check, /cannot count/);
  assert.match(hidden['visibility.public_without_secret_scanning'].could_not_check, /security_and_analysis/);
  assert.equal(hidden['visibility.personal_author_emails'].value, 1, 'public history reads with any token');
});

test('visibility: no org, or an org gh cannot read, is not measured', async () => {
  const saved = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  try {
    const none = await collect({ params: { ...params, owner: '' }, root: '/nonexistent', gh: fakeGh() });
    for (const id of metricIds) assert.match(none[id].could_not_check, /no org/, id);
  } finally {
    if (saved !== undefined) process.env.GITHUB_REPOSITORY = saved;
  }
  const gone = await run({ routes: {} });
  for (const id of metricIds) assert.match(gone[id].could_not_check, /orgs\/acme/, id);
});

// GitHub's rate-limit message names an installation or user ID, and an adopter's privacy gate refuses an ID on
// the public page (Claudius#115). Whichever read it stops, only the class of the failure is public.
test('visibility: a rate limit on any read says so and never names its ID', async () => {
  const failing = (route) => {
    const ok = fakeGh();
    const rest = async (r) => {
      if (r !== route) return ok.rest(r);
      throw Object.assign(new Error('API rate limit already exceeded for installation ID 87654321.'), { status: 403 });
    };
    return { rest, restAll: async (r) => (r === route ? rest(r) : ok.restAll(r)) };
  };
  const org = await run({ gh: failing('orgs/acme') });
  for (const id of metricIds) assert.equal(org[id].could_not_check, 'gh api orgs/acme failed: rate limited', id);
  const pages = await run({ gh: failing('repos/acme/vault/pages') });
  assert.equal(pages['visibility.private_public_pages'].could_not_check, 'gh api repos/<repo>/pages or the request to its site failed: rate limited');
  assert.equal(pages['visibility.public_without_secret_scanning'].value, 1, 'the other reads still stand');
  const emails = await run({ gh: failing('repos/acme/site/branches?per_page=100') });
  assert.equal(emails['visibility.personal_author_emails'].could_not_check, 'gh api repos/<repo>/branches or commits failed: rate limited');
  for (const out of [org, pages, emails]) assert.ok(!JSON.stringify(out).includes('87654321'), 'no ID on the page');
});

test('visibility: personal is any address but GitHub noreply or an org domain', () => {
  assert.deepEqual(['1+a@users.noreply.github.com', 'noreply@github.com', 'ops@ACME.example', 'me@mail.example', ''].map((e) => personal(e, ['acme.example'])), [false, false, false, true, false]);
});

test('visibility: the address Claude Code cloud sessions commit as is a tool, not a person', async () => {
  assert.deepEqual(['noreply@anthropic.com', ' NoReply@Anthropic.com ', 'me@anthropic.com'].map((e) => personal(e, [])), [false, false, true]);
  assert.equal(personal('noreply@anthropic.com', [], []), true, 'params.bot_emails replaces the default');
  const routes = { ...ROUTES, 'repos/acme/tools/branches?per_page=100': [{ name: 'main' }], 'repos/acme/tools/commits?sha=main&per_page=100': [commit('noreply@anthropic.com'), commit('bot@tools.example')] };
  assert.equal((await run({ routes }))['visibility.personal_author_emails'].value, 2, 'default: the Anthropic address is skipped, the other bot counts');
  const listed = await collect({ params: { ...params, bot_emails: ['bot@tools.example'] }, gh: fakeGh({ routes }), fetchPage: async () => false });
  assert.equal(listed['visibility.personal_author_emails'].value, 2, 'a listed address is skipped, the Anthropic one now counts');
  const none = await collect({ params: { ...params, bot_emails: ['noreply@anthropic.com', 'bot@tools.example'] }, gh: fakeGh({ routes }), fetchPage: async () => false });
  assert.equal(none['visibility.personal_author_emails'].value, 1, 'both skipped: only the first repo\'s own address is left');
});

// A personal account: orgs/<owner> answers 404, so the account is read through users/<owner> and user/repos.
const MINE = { login: 'jo' };
const PERSONAL_REPOS = [
  { name: 'blog', full_name: 'jo/blog', visibility: 'public', archived: false, forks_count: 1, owner: MINE },
  { name: 'diary', full_name: 'jo/diary', visibility: 'private', has_pages: true, owner: MINE },
  { name: 'other', full_name: 'sam/other', visibility: 'public', archived: false, owner: { login: 'sam' } },
];
const PERSONAL_ROUTES = {
  user: { login: 'jo' },
  'users/jo': { login: 'jo', total_private_repos: 1, blog: 'https://jo.example', email: 'jo@jo.example' },
  'repos/jo/diary/pages': { public: false, html_url: 'https://jo.github.io/diary/' },
  'repos/jo/blog': { security_and_analysis: sa() },
  'repos/jo/blog/branches?per_page=100': [{ name: 'main' }],
  'repos/jo/blog/commits?sha=main&per_page=100': [commit('jo@jo.example'), commit('noreply@anthropic.com'), commit('2+jo@users.noreply.github.com')],
};
function fakeUser({ repos = PERSONAL_REPOS, routes = PERSONAL_ROUTES } = {}) {
  const rest = async (route) => {
    if (route in routes) return structuredClone(routes[route]);
    throw Object.assign(new Error(`HTTP 404: ${route}`), { status: 404 });
  };
  return { rest, restAll: async (route) => (route.startsWith('user/repos') ? structuredClone(repos) : rest(route)) };
}
const runUser = (opts = {}) => collect({ params: { owner: 'jo', org_domains: [] }, gh: opts.gh ?? fakeUser(opts), fetchPage: async () => false });

test('visibility: a personal account is read through users/<owner> and user/repos, scanning per public repo', async () => {
  const out = await runUser();
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  for (const id of metricIds) assert.equal(out[id].could_not_check, undefined, id);
  assert.equal(out['visibility.private_public_pages'].value, 0, 'the private repo\'s site is private');
  assert.equal(out['visibility.public_without_secret_scanning'].value, 0, 'read from repos/<repo>: the list omitted it');
  assert.equal(out['visibility.personal_author_emails'].value, 1, 'the profile\'s own address is personal; noreply and the Anthropic address are not');
  assert.equal(out['visibility.requests'].value, 8, 'org 404, user, signed-in login, list, Pages, one repo, branches, commits');
  assert.ok(!JSON.stringify(out).includes('jo.example') && !/diary|other/.test(JSON.stringify(out)), 'no address, no private or foreign name');
  const off = await runUser({ routes: { ...PERSONAL_ROUTES, 'repos/jo/blog': { security_and_analysis: sa({ status: 'disabled' }) } } });
  assert.deepEqual(off['visibility.public_without_secret_scanning'].detail, [{ label: 'blog', value: 1, unit: 'repos' }]);
});

test('visibility: an owner that is neither an org nor a user is not measured, never 0', async () => {
  const neither = await runUser({ routes: { 'repos/jo/blog': {} } });
  for (const id of metricIds) assert.match(neither[id].could_not_check, /orgs\/jo.*users\/jo/, id);
});

test('visibility: a check a personal account cannot make reads not measured, never 0', async () => {
  const hidden = await runUser({ routes: { ...PERSONAL_ROUTES, 'users/jo': { login: 'jo' }, 'repos/jo/blog': {} } });
  assert.match(hidden['visibility.private_public_pages'].could_not_check, /cannot count/);
  assert.match(hidden['visibility.public_without_secret_scanning'].could_not_check, /security_and_analysis/);
  assert.equal(hidden['visibility.personal_author_emails'].value, 1, 'public history reads with any token');
  const short = await runUser({ routes: { ...PERSONAL_ROUTES, 'users/jo': { login: 'jo', owned_private_repos: 3 } } });
  assert.match(short['visibility.private_public_pages'].could_not_check, /sees 1 of the account's 3/);
});

test('visibility: a rate limit on the user read keeps the fixed reason and no ID', async () => {
  const ok = fakeUser();
  const gh = { rest: async (r) => { if (r === 'users/jo') throw Object.assign(new Error('API rate limit exceeded for user ID 12345678.'), { status: 403 }); return ok.rest(r); }, restAll: ok.restAll };
  const out = await collect({ params: { owner: 'jo', org_domains: [] }, gh: { ...gh, rest: (r) => (r === 'orgs/jo' ? Promise.reject(Object.assign(new Error('HTTP 404'), { status: 404 })) : gh.rest(r)) }, fetchPage: async () => false });
  for (const id of metricIds) assert.match(out[id].could_not_check, /users\/jo failed: rate limited/, id);
  assert.ok(!JSON.stringify(out).includes('12345678'));
});

test('visibility: a personal account read by another login is not measured, never 0', async () => {
  const other = await runUser({ routes: { ...PERSONAL_ROUTES, user: { login: 'sam' } } });
  for (const id of ['visibility.private_public_pages', 'visibility.public_without_secret_scanning', 'visibility.personal_author_emails']) assert.equal(other[id].could_not_check, 'needs a login as that user', id);
  assert.ok(typeof other['visibility.requests'].value === 'number');
  const limited = await runUser({ gh: { rest: async (r) => { if (r === 'user') throw Object.assign(new Error('rate limit, installation ID 5551234'), { status: 403 }); return fakeUser().rest(r); }, restAll: fakeUser().restAll } });
  assert.equal(limited['visibility.personal_author_emails'].could_not_check, 'gh api user failed: rate limited');
});

test('visibility: a failed per-repo scanning read keeps a fixed reason, not the admin-token one', async () => {
  const ok = fakeUser();
  const gh = { rest: async (r) => { if (r === 'repos/jo/blog') throw Object.assign(new Error('rate limit, installation ID 5551234'), { status: 403 }); return ok.rest(r); }, restAll: ok.restAll };
  const out = await collect({ params: { owner: 'jo', org_domains: [] }, gh, fetchPage: async () => false });
  assert.equal(out['visibility.public_without_secret_scanning'].could_not_check, 'gh api repos/<repo> failed: rate limited');
  assert.ok(!JSON.stringify(out).includes('5551234'));
});

test('visibility: a short list on a personal account is not measured, never 0', async () => {
  const out = await runUser({ routes: { ...PERSONAL_ROUTES, 'users/jo': { login: 'jo', total_private_repos: 1, public_repos: 3 } } });
  for (const id of ['visibility.public_without_secret_scanning', 'visibility.personal_author_emails']) assert.equal(out[id].could_not_check, 'the token lists fewer public repos than the profile counts', id);
  assert.equal(out['visibility.private_public_pages'].value, 0, 'the private count still matches');
});

test('visibility: an org never reads repos/<repo> for scanning, even for a public repo with no security_and_analysis', async () => {
  const seen = [];
  const bare = REPOS.map(({ security_and_analysis, ...r }) => r);
  const ok = fakeGh({ repos: bare });
  const gh = { rest: async (r) => (seen.push(r), ok.rest(r)), restAll: ok.restAll };
  const out = await collect({ params, gh, fetchPage: async () => false });
  assert.ok(!seen.some((r) => /^repos\/acme\/[^/?]+$/.test(r)), 'no repos/<repo> read for an org');
  assert.match(out['visibility.public_without_secret_scanning'].could_not_check, /security_and_analysis/);
});
