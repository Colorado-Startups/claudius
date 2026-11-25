// node --import ./tests/engine-lib.mjs --test collectors/code-project/cp-local.test.mjs
// Every input is a synthetic transcript or folder in a temp directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { area, collect, metricIds } from './cp-local.mjs';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cp-local-'));
const t = (sec) => new Date(Date.parse('2026-11-25T10:00:00Z') + sec * 1000).toISOString();
const line = (o) => JSON.stringify(o);

// One session: a skill listing, a hook text, two PreToolUse hook runs, a Read at 30 s and a Bash at 90 s.
function session(projects, name, { effort = 'medium', model = 'claude-sonnet-5-5' } = {}) {
  const folder = path.join(projects, '-home-user-demo');
  fs.mkdirSync(folder, { recursive: true });
  const listing = ['- plain-skill: does a thing', `- plug:one: ${'x'.repeat(30)}`, `- plug:two: ${'y'.repeat(30)}`].join('\n');
  const rows = [
    { type: 'user', timestamp: t(0), message: { content: 'SECRET PROMPT TEXT' } },
    { type: 'attachment', timestamp: t(1), attachment: { type: 'skill_listing', content: listing } },
    { type: 'attachment', timestamp: t(1), attachment: { type: 'hook_additional_context', hookEvent: 'SessionStart', content: 'h'.repeat(80) } },
    { type: 'assistant', timestamp: t(30), effort, message: { model, content: [{ type: 'tool_use', name: 'Read' }] } },
    { type: 'attachment', timestamp: t(31), attachment: { type: 'hook_success', hookEvent: 'PreToolUse', durationMs: 40 } },
    { type: 'attachment', timestamp: t(91), attachment: { type: 'hook_success', hookEvent: 'PreToolUse', durationMs: 60 } },
    { type: 'assistant', timestamp: t(90), message: { model, content: [{ type: 'tool_use', name: 'Bash' }] } },
  ];
  fs.writeFileSync(path.join(folder, `${name}.jsonl`), rows.map(line).join('\n') + '\n');
}
const go = (params, projectsDir, home = tmp()) => collect({ root: '/home/user/demo', params: { window_days: 30, subagents_dir: 'subagents', default_model: 'sonnet', project_match: 'demo', plan_usage_file: 'none.json', ...params }, now: NOW, home, projectsDir });

test('cp-local: thread-start lines come from one session, in lengths and times only', async () => {
  assert.equal(area, 'cp-local');
  const projects = tmp();
  session(projects, 'a');
  const out = await go({}, projects);
  assert.deepEqual(Object.keys(out).sort(), [...metricIds].sort());
  const listing = ['- plain-skill: does a thing', `- plug:one: ${'x'.repeat(30)}`, `- plug:two: ${'y'.repeat(30)}`].join('\n');
  assert.equal(out['cp_skills.skill_listing_tokens'].value, Math.ceil(listing.length / 4));
  assert.equal(out['cp_plugins.plugin_skill_tokens'].value, Math.ceil(listing.split('\n').slice(1).join('\n').length / 4));
  assert.equal(out['cp_hooks.hook_text_tokens'].value, 20);
  assert.equal(out['cp_hooks.hook_ms'].value, 50);
  assert.equal(out['cp_environment.thread_start_seconds'].value, 30);
  assert.equal(out['cp_work_locally.first_command_minutes'].value, 1.5);
  assert.equal(out['cp_general.high_effort_share'].value, 0);
  assert.equal(out['cp_general.above_default_share'].value, 0);
  assert.ok(!JSON.stringify(out).includes('SECRET PROMPT TEXT'), 'a prompt is never kept');
});

test('cp-local: needed servers named as failed in the latest start text are counted; other failures and error text are not', async () => {
  const projects = tmp();
  session(projects, 'a');
  const file = path.join(projects, '-home-user-demo', 'a.jsonl');
  const rendered = ['x', 'The following MCP servers are configured but failed to connect:', 'plugin:a:one (ERR_PROXY_TUNNEL): "ERROR TEXT"', 'plugin:b:two: "needs auth"', 'plugin:c:three (CONNECTION_CLOSED): "x"', '', 'later text', 'The following MCP servers are configured but failed to connect:', 'plugin:d:four (-32603): "x"', 'plugin:e:five (410): "x"'].join('\n');
  fs.appendFileSync(file, JSON.stringify({ type: 'attachment', timestamp: t(2), rendered: [{ role: 'user', content: rendered }], attachment: { type: 'deferred_tools_delta' } }) + '\n');
  const out = await go({ needed_servers: ['plugin:a:one', 'plugin:b:two', 'plugin:d:four', 'plugin:z:none'] }, projects);
  assert.equal(out['cp_environment.failed_servers'].value, 3, 'a code such as (-32603) and a second failed block are read');
  assert.deepEqual(out['cp_environment.failed_servers'].detail, [{ label: 'of 4 needed servers', value: 3, unit: 'servers' }]);
  assert.ok(!JSON.stringify(out).includes('ERROR TEXT'));
  assert.match((await go({}, projects))['cp_environment.failed_servers'].could_not_check, /no needed_servers/);
});

test('cp-local: effort above medium and a model above the default are counted per session', async () => {
  const projects = tmp();
  session(projects, 'a', { effort: 'high', model: 'claude-opus-5-5' });
  session(projects, 'b');
  const out = await go({}, projects);
  assert.equal(out['cp_general.high_effort_share'].value, 50);
  assert.equal(out['cp_general.above_default_share'].value, 50);
});

test('cp-local: no transcripts, or a bad match, is not measured and never 0', async () => {
  const none = await go({}, tmp());
  assert.match(none['cp_skills.skill_listing_tokens'].could_not_check, /no session transcript/);
  assert.ok(!('value' in none['cp_hooks.hook_ms']));
  const loose = await go({ project_match: '/' }, tmp());
  assert.match(loose['cp_environment.thread_start_seconds'].could_not_check, /would read every project folder/);
});

test('cp-local: folders are read as bytes / 4 and need their params', async () => {
  const ctx = tmp();
  fs.writeFileSync(path.join(ctx, 'a.md'), 'x'.repeat(400));
  fs.writeFileSync(path.join(ctx, 'b.bin'), 'z'.repeat(4000));
  const f1 = tmp();
  const f2 = tmp();
  fs.writeFileSync(path.join(f1, 'CLAUDE.md'), 'x'.repeat(80));
  fs.writeFileSync(path.join(f2, 'AGENTS.md'), 'x'.repeat(200));
  const out = await go({ context_dir: ctx, folder_dirs: [f1, f2] }, tmp());
  assert.equal(out['cp_context.context_tokens'].value, 100);
  assert.equal(out['cp_work_locally.folder_context_tokens'].value, 50);
  const bare = await go({ context_dir: '', folder_dirs: [] }, tmp());
  assert.match(bare['cp_context.context_tokens'].could_not_check, /no context_dir/);
  assert.match(bare['cp_work_locally.folder_context_tokens'].could_not_check, /no folder_dirs/);
  const gone = await go({ context_dir: ctx, folder_dirs: [f1, path.join(f1, 'not-there')] }, tmp());
  assert.match(gone['cp_work_locally.folder_context_tokens'].could_not_check, /does not have/, 'a folder that is not there is not measured, never 0');
});

test('cp-local: the plan usage file gives the weekly figure and its age; a missing file gives neither', async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'usage.json'), JSON.stringify({ read_at: '2026-11-23T12:00:00Z', windows: [{ label: 'Current session', percentUsed: 80 }, { label: 'Weekly limit', percentUsed: 37 }] }));
  const out = await collect({ root: d, params: { plan_usage_file: 'usage.json', project_match: 'demo' }, now: NOW, home: tmp(), projectsDir: tmp() });
  assert.equal(out['cp_usage.weekly_limit_used'].value, 37);
  assert.equal(out['cp_usage.read_age_days'].value, 2);
  const none = await go({}, tmp());
  assert.match(none['cp_usage.weekly_limit_used'].could_not_check, /plan_usage_file|none\.json/);
});
