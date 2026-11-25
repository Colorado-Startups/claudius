// Guard hook (a): before a push or a GitHub write, deny when the text matches a secret pattern or a private term.
// The terms are read at run time from a folder outside any repo: CLAUDIUS_GUARD_DIR, else ~/.claude/claudius-guard/
//   private-terms.txt   one term per line, # comments, a (?i) prefix makes a line a regular expression
//   private-repos.txt   owner/name per line: a listed repo is exempt from the term check, never from the secret check
// This repo ships no term. A refusal says what kind of match it was and never prints the matched text.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { deny, readInput, runsDirectly } from './deny.mjs';

const MAX_TEXT = 2 * 1024 * 1024;

// Assembled from parts so this file never holds a string a scanner would mistake for a real key.
export const SECRET_PATTERNS = [
  ['an AWS access key', new RegExp(`\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b`)],
  ['a GitHub token', new RegExp(`\\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})`)],
  ['an Anthropic key', new RegExp(`\\bsk-ant-[A-Za-z0-9_-]{20,}`)],
  ['an API key (sk- prefix)', new RegExp(`\\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}`)],
  ['a Slack token', new RegExp(`\\bxox[abposr]-[A-Za-z0-9-]{10,}`)],
  ['a Google API key', new RegExp(`\\bAIza[0-9A-Za-z_-]{35}\\b`)],
  ['a Stripe live key', new RegExp(`\\b[sr]k_live_[0-9A-Za-z]{20,}`)],
  ['a private key block', new RegExp(`-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----`)],
];

const guardDir = () => process.env.CLAUDIUS_GUARD_DIR || join(homedir(), '.claude', 'claudius-guard');
const lines = (file) => {
  try {
    return readFileSync(join(guardDir(), file), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
};

export function termMatcher(entries) {
  const tests = [];
  for (const entry of entries) {
    try {
      tests.push(entry.startsWith('(?i)') ? new RegExp(entry.slice(4), 'i') : new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    } catch { /* a line that is not a valid pattern is skipped */ }
  }
  return (text) => tests.some((re) => re.test(text));
}

export const findSecret = (text) => SECRET_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;

const GH_WRITE = /\bgh\s+(?:(?:issue|pr|release|gist|repo|label|workflow|discussion|project)\s+(?:create|comment|edit|review|merge|close|reopen|delete|upload|fork|run|add|new|rename)|api\b[^\n]*?(?:(?:-X|--method)[ =]*(?:POST|PATCH|PUT|DELETE)|\s-[fF]\s|--field|--raw-field|--input))/i;
const GIT_PUSH = /\bgit\s+(?:-[Cc]\s+\S+\s+)*push\b/;
const READ_ONLY_TOOL = /__(?:get_|list_|search_|issue_read$|pull_request_read$|actions_get$|actions_list$|run_secret_scanning$)/;

// Text a --body-file, -F or --input names, so a body written to a file is still read. A relative path is read from the
// session's directory (the payload's cwd), not the hook's. -F takes a file (gh issue comment -F body.md) or key=@file.
function filesNamed(command, cwd) {
  const out = [];
  for (const m of command.matchAll(/(?:--body-file|--notes-file|--input|(?<![\w-])-F)[ =]+'?"?(?:\w+=@)?([^\s'"]+)/g)) {
    try {
      const file = resolve(cwd, m[1]);
      if (existsSync(file) && statSync(file).isFile() && statSync(file).size < MAX_TEXT) out.push(readFileSync(file, 'utf8'));
    } catch { /* unreadable file: skipped */ }
  }
  return out;
}

// The lines a push would add: commit messages and added diff lines. Local git only, no network, 800 ms at most.
function outgoing(cwd) {
  const run = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 800, maxBuffer: MAX_TEXT, stdio: ['ignore', 'pipe', 'ignore'] });
  for (const base of ['@{u}', 'origin/HEAD', 'origin/main', 'origin/master']) {
    try {
      run('rev-parse', '--verify', '--quiet', base);
      return run('log', '-p', '-U0', '--no-color', '--format=%B', `${base}..HEAD`).split('\n').filter((l) => !/^(?:-|diff |index |\+\+\+ |--- |@@)/.test(l)).join('\n');
    } catch { /* try the next base */ }
  }
  return '';
}

function repoOf(toolName, input, cwd) {
  const direct = input.owner && input.repo ? `${input.owner}/${input.repo}` : null;
  if (direct) return direct.toLowerCase();
  const cmd = typeof input.command === 'string' ? input.command : '';
  const named = /(?:-R|--repo)[ =]+([\w.-]+\/[\w.-]+)/.exec(cmd) ?? /repos\/([\w.-]+\/[\w.-]+)/.exec(cmd);
  if (named) return named[1].toLowerCase();
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', timeout: 300, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/.exec(url);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function review(payload) {
  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
  const input = payload?.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : process.cwd();
  let text;
  if (toolName === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    const push = GIT_PUSH.test(cmd);
    if (!push && !GH_WRITE.test(cmd)) return null;
    text = [cmd, ...filesNamed(cmd, cwd), ...(push ? [outgoing(cwd)] : [])].join('\n');
  } else if (/^mcp__.*github/i.test(toolName) && !READ_ONLY_TOOL.test(toolName)) {
    text = JSON.stringify(input);
  } else {
    return null;
  }
  text = text.slice(0, MAX_TEXT);

  const secret = findSecret(text);
  if (secret) return `Claudius guard: this ${toolName === 'Bash' ? 'push or GitHub write' : 'GitHub write'} carries what looks like ${secret}. Remove it, then try again. Nothing was sent.`;

  const terms = lines('private-terms.txt');
  if (terms.length === 0) return null;
  const exempt = lines('private-repos.txt').map((l) => l.toLowerCase());
  const repo = repoOf(toolName, input, cwd);
  if (repo && exempt.includes(repo)) return null;
  if (termMatcher(terms)(text)) return 'Claudius guard: this write carries a private term from your private-terms list. Remove it, then try again. Nothing was sent and the term is not shown.';
  return null;
}

if (runsDirectly(import.meta)) {
  const reason = review(await readInput());
  if (reason) deny(reason);
}
