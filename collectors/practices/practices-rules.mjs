// The Best practices tab's rules, one row each. A directory row's result is the developer portal's:
// blocks (Blocking, or Validation stops), holds (Policy hold, or a choice a reviewer always checks) or
// warning. A skill row names the metric it counts. Each check reads the repo practices.mjs built and
// returns [{ file, note }], file relative to the repo root.
//
// Rows follow the docs, read 2026-11-15; where a doc and this file differ, the doc wins:
//   checklist   claude.com/docs/plugins/pre-submission-checklist
//   manifest    code.claude.com/docs/en/plugins/manifest-reference
//   hooks       code.claude.com/docs/en/hooks (33 events, 5 handler types)
//   authoring   platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
//   spec        agentskills.io/specification
//   skills      code.claude.com/docs/en/skills (the 1,536-character listing cap; the six fields
//               claude.ai and the Skills API accept)
import path from 'node:path';

const P = path.posix;
const CHECKLIST = 'https://claude.com/docs/plugins/pre-submission-checklist';
const LAYOUT = `${CHECKLIST}#repository-and-folder-layout`;
const NAMING = `${CHECKLIST}#manifest-and-plugin-name`;
const README_DOC = `${CHECKLIST}#readme-and-license`;
const FILES = `${CHECKLIST}#files-in-the-plugin-folder`;
const RUNS = `${CHECKLIST}#review-what-the-plugin-runs-and-connects-to`;
const ALWAYS = `${CHECKLIST}#choices-a-reviewer-always-checks`;
const PARTS = `${CHECKLIST}#hooks-skills-commands-and-agents`;
const AUTHORING = 'https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices';
const SPEC = 'https://agentskills.io/specification';
const SKILLS = 'https://code.claude.com/docs/en/skills';

const KiB = 1024;
const MiB = 1024 * KiB;
const isObject = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const ext = (f) => P.extname(f).slice(1).toLowerCase();
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const FONT = new Set(['ttf', 'otf', 'woff', 'woff2', 'eot']);
const SCRIPT = new Set(['sh', 'bash', 'zsh', 'js', 'mjs', 'cjs', 'ts', 'py', 'rb', 'pl']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const withoutFences = (text) => text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
// A plugin rule runs once per plugin folder; a manifest rule only where plugin.json parsed.
const each = (fn) => (repo) => repo.plugins.flatMap((p) => fn(p, repo) ?? []);
const withManifest = (fn) => each((p, repo) => (p.manifest ? fn(p.manifest, p, repo) : []));
const find = (file, note) => ({ file, ...(note ? { note } : {}) });

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ---------------------------------------------------------------- plugin name
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED = new Set(['claude', 'anthropic', 'official', 'plugin', 'mcp', 'test']);
const GENERIC = new Set([...RESERVED, 'plugins', 'tests', 'testing', 'tool', 'tools', 'helper', 'helpers', 'util', 'utils', 'utility', 'demo', 'example', 'examples', 'sample', 'my', 'the', 'skill', 'skills', 'server', 'app', 'kit', 'starter', 'template', 'basic', 'simple', 'new', 'agent', 'agents', 'ai', 'assistant', 'hello', 'world']);
// The name with case ignored and each run of separators as one hyphen, as claude plugin validate reads it.
const normName = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nonAscii = (n) => /[^\x20-\x7E]/.test(n);
// A whole reserved word, or a name claude plugin validate refuses because it passes as Anthropic's own.
function reserved(n) {
  const v = normName(n);
  return RESERVED.has(v) || /^(claude|anthropics?|cc-plugin)-/.test(v) || ['anthropics', 'claude-code', 'claude-mods'].includes(v) || (/(^|-)official(-|$)/.test(v) && /(^|-)(claude|anthropic)(-|$)/.test(v));
}
const nameOf = (m) => (typeof m.name === 'string' ? m.name : null);

// One writing system, no invisible characters. Han, kana and Hangul count as one, as Japanese mixes them.
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Georgian', 'Hebrew', 'Arabic', 'Devanagari', 'Thai'].map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
function scripts(text) {
  const found = new Set();
  for (const ch of text) if (/\p{L}/u.test(ch)) found.add(CJK.test(ch) ? 'CJK' : (SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? 'other'));
  return found;
}

// ------------------------------------------------------------- manifest keys
const KNOWN_KEYS = new Set(['$schema', 'name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'metadata', 'icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl', 'defaultEnabled', 'dependencies', 'userConfig', 'types', 'channels', 'skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'workflows', 'experimental', 'themes', 'monitors']);
const COMPONENT_KEYS = ['skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'workflows', 'themes', 'monitors'];
const EXPERIMENTAL_KEYS = new Set(['themes', 'monitors', 'evals']);
const nearComponent = (k) => k.length >= 4 && COMPONENT_KEYS.some((c) => c !== k && distance(k.toLowerCase(), c.toLowerCase()) <= 2);
// Every component path the manifest names, with the key it sits under.
function manifestPaths(m) {
  const out = [];
  const add = (key, v) => list(v).forEach((x) => typeof x === 'string' && out.push({ key, value: x }));
  for (const key of ['skills', 'agents', 'outputStyles', 'workflows', 'hooks', 'mcpServers', 'lspServers', 'types']) add(key, m[key]);
  if (isObject(m.commands)) for (const v of Object.values(m.commands)) add('commands', v?.source);
  else add('commands', m.commands);
  if (isObject(m.experimental)) for (const key of ['themes', 'monitors']) add(`experimental.${key}`, m.experimental[key]);
  return out.filter((x) => !/^https?:\/\//.test(x.value));
}
const climbs = (s) => /(^|[/\\])\.\.([/\\]|$)/.test(s);

// ------------------------------------------------------------------ commands
const LAUNCH = { npx: 'npm', bunx: 'npm', uvx: 'py' };
const PAIRED = { pnpm: 'dlx', yarn: 'dlx', pipx: 'run', uv: 'run' };
const OPERATOR = new Set(['|', '||', '&&', ';', '&']);
const NPM_PINNED = /^(?:@[^/@\s]+\/)?[^@\s/]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PY_PINNED = /^[A-Za-z0-9._-]+(?:\[[^\]]*\])?(?:==|@)\d+(?:\.\d+)*[A-Za-z0-9.+-]*$/;
// Each package launcher a command runs: [{ text, pinned }]. A launcher is npx, bunx, pnpm dlx, yarn
// dlx, uvx, pipx run or uv run; uv run is pinned by --locked or --frozen, the others by an exact version.
export function launches(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const base = P.basename(tokens[i]);
    const paired = PAIRED[base] && tokens[i + 1] === PAIRED[base];
    if (!LAUNCH[base] && !paired) continue;
    const name = paired ? `${base} ${PAIRED[base]}` : base;
    const rest = [];
    for (let j = i + (paired ? 2 : 1); j < tokens.length && !OPERATOR.has(tokens[j]); j++) rest.push(tokens[j]);
    if (name === 'uv run') {
      out.push({ text: `uv run ${rest.join(' ')}`.trim(), pinned: rest.includes('--locked') || rest.includes('--frozen') });
      continue;
    }
    const py = name === 'uvx' || name === 'pipx run';
    let pkg = null;
    for (let j = 0; j < rest.length && !pkg; j++) {
      const t = rest[j];
      if (['-p', '--package', '--from', '--spec'].includes(t)) pkg = rest[j + 1] ?? '';
      else if (/^--(package|from|spec)=/.test(t)) pkg = t.replace(/^--[a-z]+=/, '');
      else if (['--with', '--python', '--index-url', '--registry'].includes(t)) j++;
      else if (!t.startsWith('-')) pkg = t;
    }
    out.push({ text: `${name} ${pkg ?? ''}`.trim(), pinned: Boolean(pkg) && (py ? PY_PINNED : NPM_PINNED).test(pkg) });
  }
  return out;
}
const INTERPRETERS = new Set(['python', 'python3', 'node', 'ruby', 'perl', 'bash', 'sh', 'zsh', 'dash', 'deno', 'bun', 'pwsh', 'powershell']);
const INLINE = new Set(['-c', '-e', '--eval', '--command', '-Command']);
// What stops the validator following a command: another variable, a command substitution, a wildcard
// or an inline program; null when it can follow it.
function unfollowable(c) {
  if (/\$\(|`/.test(c.text)) return 'a command substitution';
  const vars = [...c.text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]).filter((v) => v !== 'CLAUDE_PLUGIN_ROOT' && v !== 'user_config');
  if (vars.length) return `the variable ${vars[0]}`;
  if (c.tokens.some((t) => !/^[a-z]+:\/\//i.test(t) && /[*?]/.test(t))) return 'a wildcard';
  for (let i = 0; i < c.tokens.length; i++) {
    if (!INTERPRETERS.has(P.basename(c.tokens[i]))) continue;
    for (let j = i + 1; j < c.tokens.length && !OPERATOR.has(c.tokens[j]); j++) if (INLINE.has(c.tokens[j])) return `an inline program (${P.basename(c.tokens[i])} ${c.tokens[j]})`;
  }
  return null;
}
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);
// The plugin files a command runs from ${CLAUDE_PLUGIN_ROOT}, relative to the plugin folder.
const rootRefs = (c) => c.tokens.flatMap((t) => [...t.matchAll(/\$\{?CLAUDE_PLUGIN_ROOT\}?([^\s"']*)/g)].map((m) => m[1].replace(/^\/+/, '').replace(/\/+$/, '')));

// --------------------------------------------------------------------- MCP
const TOKEN_SHAPE = /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/;
const SECRET_HEADER = /auth|token|key|secret|cookie|session|password/i;
// A header value that holds a literal credential: a known token shape, or eight or more characters
// left in a secret-named header once each ${...} reference and its Bearer, Basic or Token word go.
function literalSecret(name, value) {
  if (typeof value !== 'string') return false;
  if (TOKEN_SHAPE.test(value)) return true;
  const left = value.replace(/\$\{[^}]*\}/g, '').replace(/^\s*(bearer|basic|token)\b/i, '').trim();
  return SECRET_HEADER.test(name) && left.length >= 8;
}
const REMOTE_TYPES = new Set(['http', 'sse', 'ws']);
function badUrl(url) {
  if (url === '' || /^\$\{user_config\.[A-Za-z_][A-Za-z0-9_]*\}$/.test(url)) return false;
  try {
    return !['https:', 'wss:'].includes(new URL(url).protocol);
  } catch {
    return true;
  }
}

// ------------------------------------------------------------------- hooks
const EVENTS = new Set(['SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'Elicitation', 'ElicitationResult', 'SessionEnd']);
const HOOK_TYPES = new Set(['command', 'http', 'mcp_tool', 'prompt', 'agent']);
function hookProblems(src) {
  if (src.error) return [src.error];
  if (!isObject(src.data) || (!isObject(src.data.hooks) && !Array.isArray(src.data.modules))) return ['no top-level hooks object or modules array'];
  const out = [];
  for (const [event, matchers] of Object.entries(src.data.hooks ?? {})) {
    if (!EVENTS.has(event)) out.push(`unknown event ${event}`);
    for (const h of list(matchers).flatMap((m) => list(m?.hooks))) {
      if (!HOOK_TYPES.has(h?.type)) out.push(`unknown hook type ${h?.type}`);
      else if (h.type === 'http' && !/^https:\/\//.test(String(h.url ?? ''))) out.push(`an http hook URL that is not https`);
    }
  }
  return out;
}

// --------------------------------------------------------------- files
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A complete PNG, JPEG, GIF or WebP: its opening bytes and its end.
function completeImage(b) {
  // The last chunk is IEND: length, type, CRC, 4 bytes each.
  if (b.subarray(0, 8).equals(PNG)) return b.subarray(-8, -4).toString('latin1') === 'IEND';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return b[b.length - 1] === 0x3b;
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return b.readUInt32LE(4) + 8 === b.length;
  return false;
}
const SYSTEM = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX']);
const WINDOWS_BAD = /[:<>"|?*\x00-\x1F]|[. ]$|^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const COMPONENT_DIRS = ['skills', 'commands', 'agents', 'hooks', 'output-styles', 'workflows', 'themes', 'monitors'];
const misspelt = (name, want) => name !== want && distance(name.toLowerCase(), want.toLowerCase()) <= 1;
// The shortest path whose last name is bad, once per path: a/b:c/d and a/b:c/e are one finding.
const firstBad = (paths, bad) => [...new Set(paths.map((f) => { const parts = f.split('/'); const i = parts.findIndex(bad); return i < 0 ? null : parts.slice(0, i + 1).join('/'); }).filter(Boolean))];
const ENV_CREDENTIAL = [
  /\$\{?((?!CLAUDE_PLUGIN_OPTION_)[A-Z][A-Z0-9_]*(?:TOKEN|API_KEY|APIKEY|SECRET|SECRET_KEY|PASSWORD|ACCESS_KEY|_PAT))\}?(?![A-Za-z0-9_])/,
  /process\.env(?:\.|\[["'])((?!CLAUDE_PLUGIN_OPTION_)[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD))/,
  /os\.(?:environ(?:\.get\(|\[)|getenv\()\s*["']((?!CLAUDE_PLUGIN_OPTION_)[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD))/,
];
const codeOf = (text) => [...text.matchAll(/^(```|~~~)[^\n]*\n([\s\S]*?)^\1/gm)].map((m) => m[2]).join('\n') + '\n' + [...withoutFences(text).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).join('\n');

// One row per directory check.
export const DIRECTORY_RULES = [
  // Repository and folder layout
  { id: 'system_files', result: 'blocks', title: 'a macOS or Windows system file', doc: LAYOUT, check: each((p) => firstBad(p.files.map(p.rel), (s) => SYSTEM.has(s)).map((r) => find(p.at(r)))) },
  { id: 'links_submodules', result: 'blocks', title: 'a symbolic link, submodule or Git LFS pointer, not a regular file', doc: LAYOUT, check: each((p, repo) => p.files.filter((f) => ['120000', '160000'].includes(repo.mode(f)) || ((repo.size(f) ?? Infinity) <= KiB && (repo.read(f) ?? '').startsWith('version https://git-lfs.github.com/spec/'))).map((f) => find(f, repo.mode(f) === '160000' ? 'submodule' : repo.mode(f) === '120000' ? 'symbolic link' : 'LFS pointer'))) },
  { id: 'path_climbs', result: 'blocks', title: 'a path that climbs out of the plugin with ..', doc: LAYOUT, check: each((p) => [...(p.manifest ? manifestPaths(p.manifest).filter((x) => climbs(x.value)).map((x) => find(p.manifestFile, `${x.key}: ${x.value}`)) : []), ...p.commands.filter((c) => c.tokens.some(climbs)).map((c) => find(c.file, c.text))]) },
  { id: 'windows_names', result: 'blocks', title: 'a name Windows or macOS cannot hold (validation stops)', doc: LAYOUT, check: (repo) => firstBad(repo.paths, (s) => WINDOWS_BAD.test(s)).map((f) => find(f)) },
  { id: 'case_duplicates', result: 'blocks', title: 'two names that differ only by capitalization (validation stops)', doc: LAYOUT, check: (repo) => Object.values(Object.groupBy(repo.paths, (f) => f.toLowerCase())).filter((g) => g.length > 1).map((g) => find(g[0], `also ${g.slice(1).join(', ')}`)) },
  { id: 'plugin_path_chars', result: 'blocks', title: 'a folder on the plugin path with a character other than letters, digits, dots, hyphens and underscores (validation stops)', doc: LAYOUT, check: each((p) => (p.dir && p.dir.split('/').some((s) => !/^[A-Za-z0-9._-]+$/.test(s)) ? [find(p.manifestFile, p.dir)] : [])) },
  {
    id: 'gitattributes', result: 'blocks', title: 'a .gitattributes rule that rewrites the archive (validation stops)', doc: LAYOUT,
    check: (repo) => repo.paths.filter((f) => P.basename(f) === '.gitattributes').flatMap((f) => {
      const text = (repo.read(f) ?? '').replace(/#.*$/gm, '');
      const where = P.dirname(f) === '.' ? '' : P.dirname(f);
      const near = !where || repo.plugins.some((p) => !p.dir || p.dir === where || p.dir.startsWith(`${where}/`) || where.startsWith(`${p.dir}/`));
      const bad = [/\bexport-(ignore|subst)\b/.test(text) && 'export-ignore or export-subst', near && /(^|\s)[-!]?filter(=|\s|$)/m.test(text) && 'filter'].filter(Boolean);
      return bad.length ? [find(f, bad.join(', '))] : [];
    }),
  },
  { id: 'repo_too_many', result: 'blocks', title: '10,000 or more files and folders (validation stops)', doc: LAYOUT, check: (repo) => (repo.paths.length >= 10000 ? [find('.', `${repo.paths.length} files and folders`)] : []) },
  { id: 'plugin_file_too_big', result: 'blocks', title: 'a plugin file of 5 MiB or more (validation stops)', doc: LAYOUT, check: each((p, repo) => p.files.filter((f) => (repo.size(f) ?? 0) >= 5 * MiB).map((f) => find(f))) },
  // Manifest and plugin name
  { id: 'manifest_json', result: 'blocks', title: 'a plugin.json that does not parse or has no name', doc: 'https://code.claude.com/docs/en/plugins/manifest-reference', check: each((p) => (p.manifestError ? [find(p.manifestFile, p.manifestError)] : [])) },
  { id: 'name_non_ascii', result: 'blocks', title: 'a plugin name with non-ASCII characters', doc: NAMING, check: withManifest((m, p) => (nameOf(m) && nonAscii(m.name) ? [find(p.manifestFile, m.name)] : [])) },
  { id: 'name_reserved', result: 'blocks', title: 'a reserved plugin name, or one that passes as Anthropic\'s own', doc: NAMING, check: withManifest((m, p) => (nameOf(m) && !nonAscii(m.name) && reserved(m.name) ? [find(p.manifestFile, m.name)] : [])) },
  { id: 'display_script', result: 'blocks', title: 'a displayName or author.name with invisible or mixed-script characters', doc: NAMING, check: withManifest((m, p) => [['displayName', m.displayName], ['author.name', m.author?.name]].filter(([, v]) => typeof v === 'string' && (INVISIBLE.test(v) || scripts(v).size > 1)).map(([k]) => find(p.manifestFile, k))) },
  { id: 'component_keys', result: 'blocks', title: 'a component key misspelled or inside experimental', doc: NAMING, check: withManifest((m, p) => [...Object.keys(m).filter((k) => !KNOWN_KEYS.has(k) && nearComponent(k)), ...(isObject(m.experimental) ? Object.keys(m.experimental).filter((k) => !EXPERIMENTAL_KEYS.has(k) && (COMPONENT_KEYS.includes(k) || nearComponent(k))).map((k) => `experimental.${k}`) : [])].map((k) => find(p.manifestFile, k))) },
  // README and license
  { id: 'readme_words', result: 'blocks', title: 'no README of 40 words or more outside code', doc: README_DOC, check: each((p, repo) => { const f = p.files.find((x) => p.rel(x) === 'README.md') ?? p.files.find((x) => /^readme(\.\w+)?$/i.test(p.rel(x))); const words = f ? (withoutFences(repo.read(f) ?? '').match(/\S*[\p{L}\p{N}]\S*/gu) ?? []).length : 0; return words >= 40 ? [] : [find(f ?? p.at('README.md'), f ? `${words} words` : 'missing')]; }) },
  { id: 'license', result: 'blocks', title: 'no LICENSE file or license field', doc: README_DOC, check: each((p) => (p.files.some((f) => /^(licen[cs]e|copying)(\.\w+)?$/i.test(p.rel(f))) || (typeof p.manifest?.license === 'string' && p.manifest.license.trim()) ? [] : [find(p.at('LICENSE'), 'missing')])) },
  // What the plugin runs and connects to
  { id: 'launcher_unpinned', result: 'blocks', title: 'a package launcher not pinned to an exact version, or uv run without --locked or --frozen', doc: RUNS, check: each((p) => p.commands.flatMap((c) => launches(c.tokens).filter((l) => !l.pinned).map((l) => find(c.file, l.text)))) },
  { id: 'launcher_registry_config', result: 'blocks', title: 'a package-manager file that sets a package source, in a plugin with a launcher', doc: RUNS, check: each((p, repo) => (p.commands.some((c) => launches(c.tokens).length) ? p.files.filter((f) => ['.npmrc', 'bunfig.toml', 'uv.toml'].includes(P.basename(f)) && /registry|index|proxy|source|url/i.test(repo.read(f) ?? '')).map((f) => find(f)) : [])) },
  { id: 'mcp_header_secret', result: 'blocks', title: 'a literal credential in an MCP server header', doc: RUNS, check: each((p) => p.servers.flatMap((s) => Object.entries(isObject(s.cfg?.headers) ? s.cfg.headers : {}).filter(([k, v]) => literalSecret(k, v)).map(([k]) => find(s.file, `${s.name} header ${k}`)))) },
  { id: 'mcp_json_invalid', result: 'blocks', title: 'an MCP config that does not parse, or a server with no command or url', doc: RUNS, check: each((p) => [...p.mcpFiles.filter((m) => m.error).map((m) => find(m.file, m.error)), ...p.servers.filter((s) => !isObject(s.cfg) || (typeof s.cfg.command !== 'string' && typeof s.cfg.url !== 'string')).map((s) => find(s.file, `server ${s.name}`))]) },
  { id: 'mcp_url_scheme', result: 'blocks', title: 'a remote MCP server whose type is not http, sse or ws, or whose url is not https, wss, a ${user_config} reference or empty', doc: RUNS, check: each((p) => p.servers.filter((s) => isObject(s.cfg) && (typeof s.cfg.url === 'string' || REMOTE_TYPES.has(s.cfg.type)) && (!REMOTE_TYPES.has(s.cfg.type) || typeof s.cfg.url !== 'string' || badUrl(s.cfg.url))).map((s) => find(s.file, `server ${s.name}`))) },
  { id: 'mcpb_url', result: 'blocks', title: 'an MCP bundle fetched from a URL', doc: FILES, check: each((p) => p.bundles.filter((b) => /^https?:\/\//.test(b.ref)).map((b) => find(b.file, b.ref))) },
  { id: 'command_unfollowable', result: 'blocks', title: 'a hook or MCP command with another variable, a command substitution, a wildcard or an inline program', doc: RUNS, check: each((p) => p.commands.map((c) => [c, unfollowable(c)]).filter(([, why]) => why).map(([c, why]) => find(c.file, why))) },
  // Hooks, skills, commands and agents
  { id: 'hooks_json', result: 'blocks', title: 'a hooks file that does not parse, or an unknown hook event or type', doc: PARTS, check: each((p) => p.hookSources.flatMap((s) => hookProblems(s).map((why) => find(s.file, why)))) },
  { id: 'frontmatter_parse', result: 'blocks', title: 'skill, command or agent frontmatter that does not parse, or a description that is not text', doc: PARTS, check: each((p) => p.components.filter((c) => c.file && c.fm.has && (!c.fm.ok || (![undefined, null].includes(c.fm.fields.description) && typeof c.fm.fields.description !== 'string'))).map((c) => find(c.file, c.fm.ok ? 'description is not text' : c.fm.error))) },
  {
    id: 'component_spelling', result: 'blocks', title: 'a component folder or file spelt other than Claude Code expects', doc: PARTS,
    check: each((p) => {
      const rels = new Set(p.files.map((f) => p.rel(f)));
      const top = [...new Set([...rels].map((r) => r.split('/')).filter((s) => s.length > 1).map((s) => s[0]))];
      const dirs = top.filter((d) => COMPONENT_DIRS.some((want) => misspelt(d, want))).map((d) => p.at(d));
      // A near miss counts only where the real file is missing: skills/<name>/ with no SKILL.md, hooks/ with no hooks.json.
      const files = [...rels].filter((r) => {
        const m = /^(skills\/[^/]+|hooks)\/([^/]+)$/.exec(r);
        const want = m && (m[1] === 'hooks' ? 'hooks.json' : 'SKILL.md');
        return want && !rels.has(`${m[1]}/${want}`) && misspelt(m[2], want);
      }).map((r) => p.at(r));
      return [...dirs, ...files].map((f) => find(f));
    }),
  },
  // Policy holds: files the validator cannot inspect, and names
  { id: 'name_generic', result: 'holds', title: 'a plugin name made only of generic words', doc: NAMING, check: withManifest((m, p) => (nameOf(m) && !nonAscii(m.name) && !reserved(m.name) && normName(m.name).split('-').every((w) => GENERIC.has(w)) ? [find(p.manifestFile, m.name)] : [])) },
  { id: 'big_file', result: 'holds', title: 'a file over 256 KiB that is not an image or font', doc: FILES, check: each((p, repo) => p.files.filter((f) => !IMAGE.has(ext(f)) && !FONT.has(ext(f)) && (repo.size(f) ?? 0) > 256 * KiB).map((f) => find(f))) },
  { id: 'many_files', result: 'holds', title: 'more than 512 files in the plugin', doc: FILES, check: each((p) => (p.files.length > 512 ? [find(p.manifestFile, `${p.files.length} files`)] : [])) },
  { id: 'binary_file', result: 'holds', title: 'a binary other than a complete PNG, JPEG, GIF or WebP image or a font', doc: FILES, check: each((p, repo) => p.files.filter((f) => !FONT.has(ext(f))).filter((f) => { const b = repo.buffer(f); return b && b.subarray(0, 8 * KiB).includes(0) && !completeImage(b); }).map((f) => find(f))) },
  {
    id: 'image_from_code', result: 'holds', title: 'a bundled image or font named from a command, hook or script, or in code', doc: FILES,
    check: each((p, repo) => {
      const assets = p.files.filter((f) => IMAGE.has(ext(f)) || FONT.has(ext(f))).map((f) => p.rel(f));
      if (!assets.length) return [];
      const names = (text) => assets.some((a) => text.includes(a) || new RegExp(`(^|[^\\w.-])${escapeRe(P.basename(a))}(?![\\w.-])`).test(text));
      const commandFiles = new Set(p.components.filter((c) => c.kind === 'command' && c.file).map((c) => c.file));
      const texts = p.files.filter((f) => commandFiles.has(f) || SCRIPT.has(ext(f)) || ext(f) === 'md').map((f) => [f, commandFiles.has(f) || SCRIPT.has(ext(f)) ? repo.read(f) ?? '' : codeOf(repo.read(f) ?? '')]);
      const hits = new Set([...texts.filter(([, t]) => names(t)).map(([f]) => f), ...p.commands.filter((c) => names(c.text)).map((c) => c.file)]);
      return [...hits].map((f) => find(f));
    }),
  },
  { id: 'mcpb_bundle', result: 'holds', title: 'an MCP server shipped as a .mcpb or .dxt bundle', doc: FILES, check: each((p) => p.bundles.filter((b) => !/^https?:\/\//.test(b.ref)).map((b) => find(b.file, b.ref))) },
  // Choices a reviewer always checks
  { id: 'launcher_pinned', result: 'holds', title: 'a pinned package from a registry, whose dependencies resolve at install', doc: ALWAYS, check: each((p) => p.commands.flatMap((c) => launches(c.tokens).filter((l) => l.pinned).map((l) => find(c.file, l.text)))) },
  { id: 'lockfile_install', result: 'holds', title: 'a package.json beside a lockfile, installed at plugin install', doc: ALWAYS, check: each((p) => { const at = new Set(p.files.map((f) => p.rel(f))); return at.has('package.json') && ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb'].some((l) => at.has(l)) ? [find(p.at('package.json'))] : []; }) },
  { id: 'mcp_via_shell', result: 'holds', title: 'a local MCP server started through a shell or a package-manager script', doc: RUNS, check: each((p) => p.servers.filter((s) => typeof s.cfg?.command === 'string').filter((s) => { const base = P.basename(s.cfg.command.split(/\s+/)[0]); return SHELLS.has(base) || (['npm', 'yarn', 'pnpm', 'bun'].includes(base) && (list(s.cfg.args)[0] === 'run' || /\srun(\s|$)/.test(s.cfg.command))); }).map((s) => find(s.file, `server ${s.name}`))) },
  { id: 'non_shell_program', result: 'holds', title: 'a hook or MCP command that runs a plugin file other than a shell script, or a whole folder', doc: ALWAYS, check: each((p, repo) => p.commands.filter((c) => rootRefs(c).some((r) => { const f = p.at(r); if (!r || repo.isDir(f)) return true; if (/\.(sh|bash)$/.test(r)) return false; return !/^#!.*\b(sh|bash|dash|zsh)\b/.test((repo.read(f) ?? '').split('\n')[0]); })).map((c) => find(c.file, c.text))) },
  { id: 'env_credential', result: 'holds', title: 'a credential read from the user\'s environment', doc: RUNS, check: each((p, repo) => p.files.filter((f) => (repo.size(f) ?? Infinity) <= MiB && !IMAGE.has(ext(f)) && !FONT.has(ext(f))).map((f) => [f, repo.read(f) ?? '']).filter(([, t]) => !t.includes('\0')).map(([f, t]) => [f, ENV_CREDENTIAL.map((re) => re.exec(t)?.[1]).find(Boolean)]).filter(([, v]) => v).map(([f, v]) => find(f, v))) },
  // Warnings
  { id: 'name_pattern', result: 'warning', title: 'a plugin name other than lowercase letters, digits and hyphens, 64 at most', doc: NAMING, check: withManifest((m, p) => (nameOf(m) && !nonAscii(m.name) && !NAME.test(m.name) ? [find(p.manifestFile, m.name)] : [])) },
  { id: 'manifest_fields', result: 'warning', title: 'a plugin.json without description, author or version', doc: NAMING, check: withManifest((m, p) => [['description', typeof m.description === 'string' && m.description.trim()], ['author', typeof m.author?.name === 'string' && m.author.name.trim()], ['version', typeof m.version === 'string' && m.version.trim()]].filter(([, ok]) => !ok).map(([k]) => find(p.manifestFile, `no ${k}`))) },
  { id: 'hooks_json_listed', result: 'warning', title: 'hooks/hooks.json listed in plugin.json, which loads it anyway', doc: PARTS, check: withManifest((m, p) => (list(m.hooks).some((h) => typeof h === 'string' && P.normalize(h) === 'hooks/hooks.json') ? [find(p.manifestFile, 'hooks')] : [])) },
  { id: 'component_frontmatter_missing', result: 'warning', title: 'a skill, command or agent with no frontmatter or no description', doc: PARTS, check: each((p) => p.components.filter((c) => c.file && !c.described && (!c.fm.has || (c.fm.ok && [undefined, null, ''].includes(c.fm.fields.description)))).map((c) => find(c.file, c.fm.has ? 'no description' : 'no frontmatter'))) },
];

// -------------------------------------------------------------------- skills
// Plugin skills load in chat too, where only these keys are allowed and others hard-error (code.claude.com/docs/en/skills,
// read 2026-11-15). Repo .claude/skills are Claude Code only and may also use when_to_use.
const SKILL_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const TOOLS = ['gh', 'git', 'claude', 'npm', 'npx', 'node', 'python', 'python3', 'pip', 'uv', 'uvx', 'docker', 'wrangler', 'jq', 'curl'];
const SHELL_FENCE = /^(|bash|sh|shell|zsh|console|terminal)$/i;
// The commands a skill's code runs: the first word of each code span, each line of a shell fence, and
// each part after a pipe, ; or &&, when a word follows it.
function ranTools(body) {
  const fences = [...body.matchAll(/^(```|~~~)([^\n]*)\n([\s\S]*?)^\1/gm)].filter((m) => SHELL_FENCE.test(m[2].trim())).flatMap((m) => m[3].split('\n'));
  const spans = [...withoutFences(body).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const used = new Set();
  for (const line of [...fences, ...spans]) {
    for (const part of line.replace(/^\s*\$\s+/, '').split(/\s*(?:\|\||&&|\||;|\$\()\s*/)) {
      const words = part.trim().replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '').split(/\s+/);
      if (words.length > 1 && TOOLS.includes(words[0])) used.add(words[0]);
    }
  }
  return [...used];
}
const named = (tool, text) => new RegExp(`(^|[^\\w-])${tool === 'python3' ? 'python ?3?' : escapeRe(tool)}([^\\w-]|$)`, 'i').test(text);
const refFiles = (s) => s.files.filter((f) => ext(f) === 'md' && f !== s.file);
const str = (v) => (typeof v === 'string' ? v : null);

export const SKILL_RULES = [
  { id: 'skill_name_chars', metric: 'skill_rules', title: 'a skill name other than 1 to 64 lowercase letters, digits and hyphens', doc: SPEC, check: (s) => (str(s.fields.name) !== null && /^[a-z0-9-]{1,64}$/.test(s.fields.name) ? [] : [find(s.file, s.fields.name === undefined ? 'no name' : String(s.fields.name))]) },
  { id: 'skill_name_hyphens', metric: 'skill_rules', title: 'a skill name that starts or ends with a hyphen, or holds two in a row', doc: SPEC, check: (s) => (str(s.fields.name) && /^-|-$|--/.test(s.fields.name) ? [find(s.file, s.fields.name)] : []) },
  { id: 'skill_name_folder', metric: 'skill_rules', title: 'a skill name that is not its folder\'s', doc: SPEC, check: (s) => (str(s.fields.name) && s.fields.name !== s.folder ? [find(s.file, `${s.fields.name} in ${s.folder}/`)] : []) },
  { id: 'skill_name_reserved', metric: 'skill_rules', title: 'a skill name holding anthropic or claude', doc: AUTHORING, check: (s) => (str(s.fields.name) && /(^|[^a-z])(anthropic|claude)([^a-z]|$)/i.test(s.fields.name) ? [find(s.file, s.fields.name)] : []) },
  { id: 'skill_desc_length', metric: 'skill_rules', title: 'a skill description that is not 1 to 1,024 characters of text', doc: AUTHORING, check: (s) => { const d = str(s.fields.description); return d && d.length <= 1024 ? [] : [find(s.file, d === null ? 'no description' : `${d.length} characters`)]; } },
  { id: 'skill_desc_xml', metric: 'skill_rules', title: 'a skill description with XML tags', doc: AUTHORING, check: (s) => (/<\/?[A-Za-z][\w:-]*(\s[^<>]*)?\/?>/.test(str(s.fields.description) ?? '') ? [find(s.file)] : []) },
  { id: 'skill_desc_person', metric: 'skill_rules', title: 'a skill description not in the third person', doc: AUTHORING, check: (s) => (/\bI (?:can|will)\b|\bI'll\b|(?:^|[.!?]\s+)You (?:can|should|will)\b/.test(str(s.fields.description) ?? '') ? [find(s.file)] : []) },
  { id: 'skill_desc_when', metric: 'skill_rules', title: 'a skill description that does not say when to use it', doc: AUTHORING, check: (s) => { const d = str(s.fields.description); return d && !str(s.fields.when_to_use) && !/\b(when(ever)?|if|before|after|use (this|to|for))\b/i.test(d) ? [find(s.file)] : []; } },
  { id: 'skill_listing_cap', metric: 'skill_rules', title: 'a description and when_to_use over the 1,536-character listing cap', doc: SKILLS, check: (s) => { const n = (str(s.fields.description) ?? '').length + (str(s.fields.when_to_use) ? 1 + s.fields.when_to_use.length : 0); return n > 1536 ? [find(s.file, `${n} characters`)] : []; } },
  { id: 'skill_fields', metric: 'skill_rules', title: 'a plugin skill field claude.ai and the Skills API do not accept', doc: SKILLS, check: (s) => { const extra = s.plugin ? Object.keys(s.fields).filter((k) => !SKILL_FIELDS.has(k)) : []; return extra.length ? [find(s.file, extra.join(', '))] : []; } },
  { id: 'skill_body_lines', metric: 'skill_size', title: 'a SKILL.md body of 500 lines or more', doc: AUTHORING, check: (s) => { const n = s.body.replace(/\n$/, '').split('\n').length; return n >= 500 ? [find(s.file, `${n} lines`)] : []; } },
  { id: 'skill_ref_toc', metric: 'skill_size', title: 'a reference file over 100 lines with no contents list at the top', doc: AUTHORING, check: (s, repo) => refFiles(s).filter((f) => { const lines = (repo.read(f) ?? '').replace(/\n$/, '').split('\n'); const head = lines.slice(0, 30); return lines.length > 100 && !head.some((l) => /^#{1,6}\s*(table of )?contents\b/i.test(l)) && head.filter((l) => /^\s*[-*]\s*\[[^\]]+\]\(#/.test(l)).length < 3; }).map((f) => find(f)) },
  { id: 'skill_ref_nested', metric: 'skill_size', title: 'a reference file that links another, more than one level deep', doc: AUTHORING, check: (s, repo) => { const mds = new Set(refFiles(s)); return refFiles(s).filter((f) => [...withoutFences(repo.read(f) ?? '').matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)].some((m) => !/^[a-z]+:/i.test(m[1]) && mds.has(P.normalize(P.join(P.dirname(f), m[1]))))).map((f) => find(f)) } },
  { id: 'skill_backslash', metric: 'skill_size', title: 'a path written with backslashes', doc: AUTHORING, check: (s, repo) => [s.file, ...refFiles(s)].filter((f) => /(?:^|[\s`"'([])(?:[\w.-]+\\)+[\w.-]+\.[A-Za-z0-9]{1,5}\b/m.test(f === s.file ? s.body : repo.read(f) ?? '')).map((f) => find(f)) },
  { id: 'skill_tools_unnamed', metric: 'skill_tools_unnamed', title: 'a skill that runs tools its compatibility field or a Requires line does not name', doc: AUTHORING, check: (s) => { const text = [str(s.fields.compatibility) ?? '', ...s.body.split('\n').filter((l) => /^\s*\**Requires\b/.test(l))].join('\n'); const missing = ranTools(s.body).filter((t) => !named(t, text)); return missing.length ? [find(s.file, missing.join(', '))] : []; } },
];
