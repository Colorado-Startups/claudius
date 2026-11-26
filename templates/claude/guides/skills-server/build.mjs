#!/usr/bin/env node
// Bundles a folder of Agent Skills into one deployable module.
//   node build.mjs <skills-dir> [out-dir] [server-name]
// Every direct subfolder with a SKILL.md is a skill. Writes <out-dir>/catalog.json and <out-dir>/worker.mjs
// (worker.mjs of this folder, the catalog, and `export default { fetch }`). Standard library only.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The skills extension's limits per skill (modelcontextprotocol.io/extensions/skills, Limits).
const MAX_FILES = 512;
const MAX_BYTES = 16 * 1024 * 1024;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/; // Agent Skills naming rule, with the 64-character cap checked below
const SKIP = new Set(['__pycache__', 'node_modules']);
const MIME = { '.md': 'text/markdown', '.py': 'text/x-python', '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/html', '.yml': 'application/yaml', '.yaml': 'application/yaml', '.js': 'text/javascript', '.mjs': 'text/javascript', '.sh': 'text/x-shellscript' };

// Flat `key: value` frontmatter, which every skill here uses. Anything else fails loudly rather than being half-read.
export function parseFrontmatter(src, where) {
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
  if (!m) throw new Error(`${where}: no frontmatter`);
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv || kv[2] === '' || /^[|>]/.test(kv[2]) || /^[[{]/.test(kv[2])) throw new Error(`${where}: frontmatter line is not a flat "key: value": ${line}`);
    let v = kv[2];
    if (/^"[\s\S]*"$/.test(v)) { try { v = JSON.parse(v); } catch { throw new Error(`${where}: bad double-quoted value: ${line}`); } }
    else if (/^'[\s\S]*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    else if (v === 'true' || v === 'false') v = v === 'true';
    else if (v === 'null') v = null;
    else if (/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/.test(v)) v = Number(v);
    // A plain value that a YAML parser would read another way is refused, so the served frontmatter is the file's.
    else if (/(^|\s)#|:\s|:$|[ \t]$|^[&*!%@`|>'"[\]{},?-]|^(~|y|n|yes|no|on|off|true|false|null|[-+]?\.?\d[\w.+-]*)$/i.test(v)) throw new Error(`${where}: this value is not a plain YAML scalar (quote it): ${line}`);
    out[kv[1]] = v;
  }
  for (const k of ['name', 'description']) if (typeof out[k] !== 'string' || !out[k]) throw new Error(`${where}: frontmatter needs ${k}`);
  return out;
}

// A link could point outside the folder, so a link anywhere in a skill fails the build.
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => {
    if (e.name.startsWith('.') || SKIP.has(e.name)) return [];
    const p = join(dir, e.name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`${p}: a symbolic link is not served`);
    return st.isDirectory() ? walk(p) : st.isFile() ? [p] : [];
  });
}

export function buildCatalog(skillsDir, serverName = 'skills-server') {
  const skills = [];
  for (const d of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (d.name.startsWith('.') || SKIP.has(d.name)) continue;
    const root = join(skillsDir, d.name);
    if (lstatSync(root).isSymbolicLink()) throw new Error(`${root}: a symbolic link is not served`);
    if (!lstatSync(root).isDirectory()) continue;
    let md;
    try { md = readFileSync(join(root, 'SKILL.md'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const frontmatter = parseFrontmatter(md, `${d.name}/SKILL.md`);
    if (frontmatter.name !== d.name) throw new Error(`${d.name}: frontmatter name "${frontmatter.name}" must equal the folder name`);
    if (!NAME.test(d.name) || d.name.length > 64) throw new Error(`${d.name}: not a valid skill name`);
    const paths = walk(root);
    if (paths.length > MAX_FILES) throw new Error(`${d.name}: ${paths.length} files, over the ${MAX_FILES} limit`);
    let total = 0;
    const files = paths.map((p) => {
      const bytes = readFileSync(p);
      total += bytes.length;
      const path = relative(root, p).split(sep).join('/');
      // The path goes into a skill:// URI as is, so keep it to characters that need no encoding.
      if (!/^[A-Za-z0-9._\-/]+$/.test(path)) throw new Error(`${d.name}/${path}: use only letters, digits, . _ - and / in a file path`);
      const entry = { path, mimeType: MIME[extname(p)] ?? 'application/octet-stream', digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length };
      // Text when the bytes are valid UTF-8 (the digest covers the raw bytes either way), else base64.
      try { entry.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { entry.blob = bytes.toString('base64'); }
      return entry;
    });
    if (total > MAX_BYTES) throw new Error(`${d.name}: ${total} bytes, over the ${MAX_BYTES} limit`);
    skills.push({ name: d.name, frontmatter, files });
  }
  if (!skills.length) throw new Error(`${skillsDir}: no skill folders (each needs a SKILL.md)`);
  return { serverInfo: { name: serverName, version: '1.0.0' }, skills };
}

export function renderWorker(catalog) {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs'), 'utf8');
  return `${src}\nconst CATALOG = ${JSON.stringify(catalog)};\nconst handle = createHandler(CATALOG);\nexport default { fetch: (request, env) => handle(request, env) };\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const [skillsDir, outDir = 'dist', name] = process.argv.slice(2);
  if (!skillsDir) { console.error('usage: node build.mjs <skills-dir> [out-dir] [server-name]'); process.exit(2); }
  const catalog = buildCatalog(skillsDir, name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  writeFileSync(join(outDir, 'worker.mjs'), renderWorker(catalog));
  console.log(`${catalog.skills.length} skills, ${catalog.skills.reduce((n, s) => n + s.files.length, 0)} files -> ${outDir}`);
}
