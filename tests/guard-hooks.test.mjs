// node --test tests/guard-hooks.test.mjs
// The two guard hooks in plugin/hooks/. Every term, address and key here is made up: the terms live on example.com,
// and a key is joined from parts at run time so no scanner finds one in this file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runsDirectly } from '../plugin/hooks/deny.mjs';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'hooks');
const TERM = 'acme-widgets.example.com';
const FAKE_AWS = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const FAKE_GH = ['ghp', '_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

// Runs one hook with a JSON payload and only the env named here. Returns { code, out, ms }.
function run(script, payload, env = {}) {
  const t = Date.now();
  const r = spawnSync('node', [join(HOOKS, script)], { input: JSON.stringify(payload), encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp('home-'), ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - t };
}
const decision = (r) => (r.out ? JSON.parse(r.out).hookSpecificOutput : null);

function guardDir({ terms = [TERM], privateRepos = [] } = {}) {
  const dir = tmp('guard-');
  if (terms) writeFileSync(join(dir, 'private-terms.txt'), `# made-up terms\n${terms.join('\n')}\n`);
  if (privateRepos.length) writeFileSync(join(dir, 'private-repos.txt'), `${privateRepos.join('\n')}\n`);
  return { CLAUDIUS_GUARD_DIR: dir };
}
const bash = (command, cwd = tmpdir()) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const mcp = (name, input) => ({ tool_name: `mcp__github__${name}`, tool_input: input, cwd: tmpdir() });

// ------------------------------------------------------------------ hook (a)

test('write guard: a clean issue comment passes with no output', () => {
  const r = run('guard-public-write.mjs', bash('gh issue comment 4 --body "fixed in the next pull request"'), guardDir());
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('write guard: a key in a gh body is refused, and the refusal never shows the key', () => {
  const r = run('guard-public-write.mjs', bash(`gh issue comment 4 --body "use ${FAKE_AWS}"`), guardDir());
  assert.equal(r.code, 0);
  const d = decision(r);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /AWS access key/);
  assert.ok(!r.out.includes(FAKE_AWS));
});

test('write guard: a GitHub MCP write with a token is refused; a read of the same text passes', () => {
  const write = run('guard-public-write.mjs', mcp('add_issue_comment', { owner: 'o', repo: 'r', issue_number: 1, body: FAKE_GH }), guardDir());
  assert.equal(decision(write).permissionDecision, 'deny');
  const read = run('guard-public-write.mjs', mcp('get_file_contents', { owner: 'o', repo: 'r', path: FAKE_GH }), guardDir());
  assert.equal(read.out, '');
});

test('write guard: a private term is refused, case-insensitively, and never printed', () => {
  const r = run('guard-public-write.mjs', mcp('issue_write', { method: 'create', owner: 'o', repo: 'r', title: 'x', body: `see ${TERM.toUpperCase()}` }), guardDir());
  assert.equal(decision(r).permissionDecision, 'deny');
  assert.ok(!r.out.toLowerCase().includes('acme'));
});

test('write guard: a (?i) line is a regular expression', () => {
  const env = guardDir({ terms: ['(?i)acme[- ]widgets'] });
  assert.equal(decision(run('guard-public-write.mjs', bash('gh pr comment 1 --body "Acme Widgets shipped"'), env)).permissionDecision, 'deny');
});

test('write guard: with no terms file the secret check still runs and a term passes', () => {
  const env = guardDir({ terms: null });
  assert.equal(run('guard-public-write.mjs', bash(`gh issue comment 1 --body "${TERM}"`), env).out, '');
  assert.equal(decision(run('guard-public-write.mjs', bash(`gh issue comment 1 --body "${FAKE_GH}"`), env)).permissionDecision, 'deny');
});

test('write guard: a repo listed as private is exempt from the term check, never from the secret check', () => {
  const env = guardDir({ privateRepos: ['Example-Org/Private-Repo'] });
  const input = { method: 'create', owner: 'example-org', repo: 'private-repo', title: 'x' };
  assert.equal(run('guard-public-write.mjs', mcp('issue_write', { ...input, body: TERM }), env).out, '');
  assert.equal(decision(run('guard-public-write.mjs', mcp('issue_write', { ...input, body: FAKE_AWS }), env)).permissionDecision, 'deny');
});

test('write guard: a body file named by --body-file is read', () => {
  const file = join(tmp('body-'), 'body.md');
  writeFileSync(file, `notes about ${TERM}`);
  assert.equal(decision(run('guard-public-write.mjs', bash(`gh pr create --title t --body-file ${file}`), guardDir())).permissionDecision, 'deny');
});

test('write guard: a bare -F file is read, and a relative path is read from the session cwd, not the hook cwd', () => {
  const dir = tmp('body-');
  writeFileSync(join(dir, 'body.md'), `notes about ${TERM}`);
  for (const cmd of ['gh issue comment 5 -F body.md', 'gh pr create --title t -F body.md', 'gh api repos/o/r/issues -X POST -F body=@body.md', "gh pr create --body-file 'body.md'"]) {
    assert.equal(decision(run('guard-public-write.mjs', bash(cmd, dir), guardDir()))?.permissionDecision, 'deny', cmd);
  }
  assert.equal(run('guard-public-write.mjs', bash('gh issue comment 5 -F other.md', dir), guardDir()).out, '', 'a file that is not there is skipped');
});

test('guards: a hook started by a path with a space, or through a symlink, still runs (no fail open before Node 24.2)', () => {
  const root = tmp('sp ace-');
  const copy = join(root, 'my hooks');
  cpSync(HOOKS, copy, { recursive: true });
  const link = join(root, 'link.mjs');
  symlinkSync(join(copy, 'guard-public-write.mjs'), link);
  const payload = bash(`gh issue comment 5 --body "${FAKE_AWS}"`);
  for (const file of [join(copy, 'guard-public-write.mjs'), link]) {
    const r = spawnSync('node', [file], { input: JSON.stringify(payload), encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp('home-') } });
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny', file);
  }
});

test('guards: without import.meta.main (Node before 24.2), the real-path comparison still says yes for a spaced path or a symlink, and no for another file', () => {
  const root = mkdtempSync(join(tmpdir(), 'sp ace-'));
  const real = join(root, 'my hook.mjs');
  writeFileSync(real, '');
  const link = join(root, 'link.mjs');
  symlinkSync(real, link);
  const saved = process.argv[1];
  try {
    for (const started of [real, link]) {
      process.argv[1] = started;
      assert.equal(runsDirectly({ url: pathToFileURL(real).href }), true, started);
    }
    process.argv[1] = real;
    assert.equal(runsDirectly({ url: pathToFileURL(join(root, 'other.mjs')).href }), false);
    assert.equal(runsDirectly({ main: false, url: pathToFileURL(real).href }), false, 'import.meta.main wins when it exists');
  } finally {
    process.argv[1] = saved;
  }
});

test('write guard: commands that are not a push or a GitHub write are left alone', () => {
  for (const c of [`echo ${FAKE_AWS}`, `grep ${TERM} notes.txt`, 'gh issue list', 'gh api repos/o/r/issues', 'git status']) {
    assert.equal(run('guard-public-write.mjs', bash(c), guardDir()).out, '', c);
  }
});

test('write guard: git push is refused when an outgoing commit adds a key, and passes when it does not', () => {
  const origin = tmp('origin-');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const work = tmp('work-');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'remote', 'add', 'origin', origin);
  writeFileSync(join(work, 'a.txt'), 'one\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'first');
  git(work, 'push', '-q', '-u', 'origin', 'main');

  writeFileSync(join(work, 'b.txt'), 'two\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'clean change');
  assert.equal(run('guard-public-write.mjs', bash('git push', work), guardDir()).out, '');

  writeFileSync(join(work, 'c.txt'), `token=${FAKE_GH}\n`);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'add config');
  const r = run('guard-public-write.mjs', bash('git push origin main', work), guardDir());
  assert.equal(decision(r).permissionDecision, 'deny');
  assert.ok(!r.out.includes(FAKE_GH));
});

test('write guard: a push that removes a key is not refused', () => {
  const origin = tmp('origin-');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const work = tmp('work-');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'remote', 'add', 'origin', origin);
  writeFileSync(join(work, 'a.txt'), `${FAKE_GH}\n`);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'first');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  writeFileSync(join(work, 'a.txt'), 'clean\n');
  git(work, 'commit', '-q', '-am', 'remove it');
  assert.equal(run('guard-public-write.mjs', bash('git push', work), guardDir()).out, '');
});

test('write guard: bad input never blocks', () => {
  const r = spawnSync('node', [join(HOOKS, 'guard-public-write.mjs')], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// ------------------------------------------------------------------ hook (b)

function repoWithList(list) {
  const dir = tmp('repo-');
  if (list) {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'claudius-deny.json'), JSON.stringify(list));
  }
  return dir;
}
const call = (dir, tool_name) => run('guard-deny-list.mjs', { tool_name, tool_input: {}, cwd: dir }, { CLAUDE_PROJECT_DIR: dir });

test('deny list: a listed tool is refused with the repo reason; an unlisted tool passes', () => {
  const dir = repoWithList({ tools: ['mcp__Mail__send_message', 'mcp__Mail__trash_*'], reason: 'This repo never sends mail.' });
  const sent = call(dir, 'mcp__Mail__send_message');
  assert.equal(decision(sent).permissionDecision, 'deny');
  assert.match(decision(sent).permissionDecisionReason, /never sends mail/);
  assert.equal(decision(call(dir, 'mcp__Mail__trash_thread')).permissionDecision, 'deny');
  assert.equal(call(dir, 'mcp__Mail__search_threads').out, '');
  assert.equal(call(dir, 'Bash').out, '');
});

test('deny list: a connector prefix on the real name still matches the listed name', () => {
  const dir = repoWithList({ tools: ['mcp__Mail__send_message'] });
  assert.equal(decision(call(dir, 'mcp__plugin_x_Mail__send_message')).permissionDecision, 'deny');
});

test('deny list: a repo with no list, a broken list or an empty one keeps every tool', () => {
  assert.equal(call(repoWithList(null), 'mcp__Mail__send_message').out, '');
  const broken = repoWithList({});
  writeFileSync(join(broken, '.claude', 'claudius-deny.json'), '{ not json');
  assert.equal(call(broken, 'mcp__Mail__send_message').out, '');
  assert.equal(call(repoWithList({ tools: [] }), 'mcp__Mail__send_message').out, '');
});

test('deny list: one repo\'s list does not reach a session in another repo', () => {
  const listed = repoWithList({ tools: ['mcp__Mail__send_message'] });
  const other = repoWithList(null);
  assert.equal(decision(call(listed, 'mcp__Mail__send_message')).permissionDecision, 'deny');
  assert.equal(call(other, 'mcp__Mail__send_message').out, '');
});

// ------------------------------------------------------------------ both: what a guard may never do

test('guards: each call stays under 1000 ms, and a pass prints nothing, so the hooks add no start-up text', () => {
  const dir = repoWithList({ tools: ['mcp__Mail__send_message'] });
  assert.ok(call(dir, 'Bash').ms < 1000);
  const w = run('guard-public-write.mjs', bash('gh issue comment 1 --body ok'), guardDir());
  assert.ok(w.ms < 1000);
  assert.equal(w.out, '');
});

test('guards: hooks.json has only PreToolUse command hooks, and no source can allow, write a file or reach the network', () => {
  const cfg = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg.hooks), ['PreToolUse']);
  for (const m of cfg.hooks.PreToolUse) for (const h of m.hooks) {
    assert.equal(h.type, 'command');
    assert.ok(h.timeout <= 5);
    assert.match(h.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}"\/hooks\/guard-[a-z-]+\.mjs$/);
  }
  for (const f of readdirSync(HOOKS).filter((n) => n.endsWith('.mjs'))) {
    const src = readFileSync(join(HOOKS, f), 'utf8');
    assert.ok(!/permissionDecision:\s*['"](allow|ask|defer)/.test(src), `${f} grants`);
    assert.ok(!/\b(writeFile|appendFile|unlink|rmSync|rename|copyFile|mkdir|chmod|createWriteStream)(Sync)?\(/.test(src), `${f} writes a file`);
    assert.ok(!/node:(https?|net|tls|dns|dgram|http2)|\bfetch\(|XMLHttpRequest|WebSocket/.test(src), `${f} reaches the network`);
    assert.ok(!/(?<![.\w])(exec|execSync|spawn|spawnSync)\(/.test(src), `${f} runs a shell`);
    for (const m of src.matchAll(/import \{([^}]*)\} from 'node:child_process'/g)) assert.equal(m[1].trim(), 'execFileSync', `${f}: only execFileSync, without a shell`);
    assert.ok(!src.includes('—'), `${f} em dash`);
  }
});
