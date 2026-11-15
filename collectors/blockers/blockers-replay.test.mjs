// More tests for the Blockers collector, split out of blockers.test.mjs to keep each file under the Read limit:
// held or false alarm, and what came after a block. Shared inputs are in blockers-fixtures.mjs.
// node --test quality/collectors/blockers/blockers-replay.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fixSignals, outcomeOf, outputTargets, segments, neutralStep, signalForm, similar, steps, words, writesFile } from './blockers.mjs';
import { reviewerTokens } from './blockers-metrics.mjs';
import { reviewedPrs } from './blockers-transcripts.mjs';
import { at, params } from './blockers-fixtures.mjs';

const bashCall = (command, min, block = null) => ({ family: 'Bash', at: Date.parse(at(min)), command, words: words(command), segments: segments(command), steps: steps(command), block, error: Boolean(block) });
const fixes = fixSignals(params.fix_signals);
const resetBlock = { kind: 'guard', rules: ['git-reset-hard'], fixNamed: true };
const readBlock = { kind: 'guard', rules: ['credential-file-read'], fixNamed: true };
const mergeLoop = bashCall('for n in 7 8; do gh pr merge $n -R acme/site --merge --match-head-commit $(gh pr view $n -R acme/site --json headRefOid --jq .headRefOid); done', 0, { kind: 'guard', rules: ['gh-merge-unsafe'], fixNamed: true });

test('every fix signal compiles on Node 22: no regex modifier group', () => {
  // (?i:...) arrived in V8 12.5 (Node 23); package.json allows Node 22, where new RegExp throws on it.
  for (const [rule, list] of Object.entries(params.fix_signals)) {
    for (const signal of list) {
      const source = signal.startsWith('!') ? signal.slice(1) : signal;
      assert.ok(!/\(\?[a-z]+:/.test(source), `${rule}: ${signal} uses a modifier group`);
      assert.doesNotThrow(() => new RegExp(source), `${rule}: ${signal}`);
    }
  }
});

test('segments: wrappers, env, cd, redirections and bash -c say nothing about what runs; flags do', () => {
  assert.deepEqual(segments('cd "/a b" && FOO=1 time git reset --hard origin/main 2>&1'), ['git reset --hard origin/main']);
  assert.deepEqual(segments(`bash -c "git push origin main"`), ['git push origin main']);
  assert.deepEqual(segments(`echo 'a && b' | grep -n x > out.txt`), ['echo a && b', 'grep -n x']);
  assert.notDeepEqual(segments('git push --force origin x'), segments('git push origin x'), 'a dropped flag is a changed command');
  assert.deepEqual(segments('echo x >| f && cmd &> log && ls'), ['echo x', 'cmd', 'ls'], '>| is a redirect, not a pipe');
  for (const [seg, files] of [["echo 'a > b'", []], ['git commit 2>&1', []], ['cmd >/dev/null 2>&1', []], ['cmd >&2', []], ['cmd >&-', []], ['echo x > out.txt', ['out.txt']], ['cmd &> log', ['log']], ['cmd >| x', ['x']], ['cmd >> "a b"', ['a b']], ['exec 3<>f', ['f']]]) {
    assert.deepEqual(outputTargets(seg), files, seg);
  }
  assert.deepEqual(steps('cd "/a b" && HUSKY=0  git commit -m x 2>&1 | tail -3'), ['cd "/a b"', 'HUSKY=0 git commit -m x 2>&1', 'tail -3'], 'steps keep the env, the cd and the redirections that segments drop');
  assert.deepEqual(steps(`bash -c "git push origin x && ls"`), ['git push origin x', 'ls']);
  for (const step of ['> .git/hooks/pre-commit', 'exec 3>.git/hooks/pre-commit', 'tee out.txt', 'sort -uo out list', 'git diff --output=out', 'grep -o x f']) assert.ok(writesFile(step), step);
  for (const step of ['git commit -m x 2>&1', 'cmd >/dev/null', "echo 'a > b'", 'git push -u origin x']) assert.ok(!writesFile(step), step);
});

test('held: the next similar command applied the fix the block named', () => {
  const blocked = bashCall('cd /repo && git fetch && git reset --hard origin/main', 0, resetBlock);
  assert.equal(outcomeOf(blocked, [bashCall('cd /repo && git fetch && git merge --ff-only origin/main', 1)], { fixes }), 'fixed');
  const deploy = bashCall('cd site && npm run deploy:staging -- --config site/wrangler.jsonc site/dist', 0, { kind: 'guard', rules: ['npm-deploy-script'] });
  assert.equal(outcomeOf(deploy, [bashCall('cd site && npx wrangler deploy --config site/wrangler.jsonc site/dist', 1)], { fixes }), 'fixed', 'a compliant way the guard does not name');
  // With no argument in common it is still a retry: it runs the named fix.
  assert.equal(outcomeOf(bashCall('npm run deploy:staging', 0, deploy.block), [bashCall('npx wrangler deploy --env staging', 1)], { fixes }), 'fixed');
  const read = bashCall('cat ~/.zshenv', 0, readBlock);
  assert.equal(outcomeOf(read, [bashCall('ls -la ~/.zshenv', 1)], { fixes }), 'fixed', "the fix text's own command");
  assert.equal(outcomeOf(mergeLoop, [bashCall('gh pr view 7 -R acme/site --json headRefOid --jq .headRefOid', 1)], { fixes }), 'fixed', 'stopped at the open pull request');
  assert.equal(outcomeOf(blocked, [bashCall('cd /repo && git fetch && git stash push -m wip && git merge --ff-only origin/main', 1)], { fixes }), 'fixed', 'each step is the block\'s own or a fix');
  assert.equal(outcomeOf(blocked, [bashCall('cd /repo && git fetch origin && git merge --ff-only origin/main', 1)], { fixes }), 'unfixed', 'a fetch of its own is a new step: no step is neutral');
});

test('held: the retry ran only the blocked command\'s own steps', () => {
  const blocked = bashCall('git -C clone reset -q --hard 6696f16 && mkdir -p clone/docs && git -C clone add docs/x.md', 0, resetBlock);
  assert.equal(outcomeOf(blocked, [bashCall('mkdir -p clone/docs && git -C clone add docs/x.md', 1)], { fixes }), 'dropped');
  assert.equal(outcomeOf(blocked, [bashCall('git status --short | head -3; mkdir -p clone/docs && git -C clone add docs/x.md', 1)], { fixes }), 'dropped', 'an allowlisted status check adds nothing');
  assert.equal(outcomeOf(blocked, [bashCall('git worktree prune; mkdir -p clone/docs && git -C clone add docs/x.md', 1)], { fixes }), 'unfixed', 'a git verb off the allowlist is a new step');
  assert.equal(outcomeOf(blocked, [bashCall('mkdir -p clone/docs && git -C clone add docs/x.md', 1), bashCall('mkdir -p clone/docs && git -C clone add docs/x.md && touch clone/x', 2)], { fixes }), 'unfixed', 'every similar success counts, not only the first');
  assert.equal(outcomeOf(blocked, [bashCall('mkdir -p clone/docs && git -C clone checkout -- . && git -C clone add docs/x.md', 1)], { fixes }), 'unfixed', 'a new step in its place is a rephrase');
});

test('held: no similar command followed, or none succeeded', () => {
  const blocked = bashCall('git reset --hard origin/main', 0, resetBlock);
  assert.equal(outcomeOf(blocked, [], { fixes }), 'none');
  assert.equal(outcomeOf(blocked, [bashCall('npm test -- a.test.ts', 1)], { fixes }), 'none', 'another task is no retry');
  assert.equal(outcomeOf(blocked, [{ ...bashCall('git reset --hard origin/main', 1, resetBlock) }], { fixes }), 'none', 'blocked again is no run');
});

test('false alarm: the next similar command ran without the fix (a misfire, or routed around)', () => {
  const glob = bashCall('cat site/astro.config.mjs site/vitest.config.* site/package.json', 0, readBlock);
  assert.equal(outcomeOf(glob, [bashCall('cat site/astro.config.mjs site/vitest.config.ts site/package.json', 1)], { fixes }), 'unfixed', 'the harmless read, rephrased');
  const noFix = bashCall('wrangler delete --force site', 0, { kind: 'guard', rules: ['wrangler-one-way'] });
  assert.equal(outcomeOf(noFix, [bashCall('wrangler delete site', 1)], { fixes }), 'unfixed', 'a rule that names no fix: any similar retry');
  // Only the next similar success counts: a later fix does not undo a workaround that already ran.
  const blocked = bashCall('git fetch && git reset --hard origin/main', 0, resetBlock);
  assert.equal(outcomeOf(blocked, [bashCall('git fetch && git checkout -B main origin/main', 1), bashCall('git fetch && git merge --ff-only origin/main', 2)], { fixes }), 'unfixed');
  // A veto outweighs a fix signal: viewing the PR and then merging it through the API routes around the rule.
  // A workaround later in the window counts even when the first similar success looked compliant.
  const reset = bashCall('git fetch && git reset --hard origin/main', 0, resetBlock);
  assert.equal(outcomeOf(reset, [bashCall('git fetch', 1), bashCall('git fetch && git checkout -B main origin/main', 2)], { fixes }), 'unfixed');
  assert.equal(outcomeOf(reset, [bashCall('git fetch origin && git merge --ff-only origin/main', 1), bashCall('git fetch && git checkout -B main origin/main', 2)], { fixes }), 'unfixed');
  // A step that writes a file is never neutral: an echo that rewrites a hook is no status check.
  const skip = bashCall('git commit --no-verify -m wip', 0, { kind: 'guard', rules: ['git-skip-hooks'], fixNamed: true });
  assert.equal(outcomeOf(skip, [bashCall("echo 'exit 0' > .git/hooks/pre-commit && git commit -m wip", 1)], { fixes }), 'unfixed', 'the hook rewritten, then the commit');
  assert.equal(outcomeOf(skip, [bashCall('printf x > .githooks/pre-commit && git commit -m wip', 1)], { fixes }), 'unfixed');
  assert.equal(outcomeOf(skip, [bashCall('git commit -m wip && echo done > .git/HEAD', 1)], { fixes }), 'unfixed');
  assert.equal(outcomeOf(skip, [bashCall('git commit -m wip && sort -o .git/hooks/pre-commit list', 1)], { fixes }), 'unfixed', 'sort -o writes too');
  assert.equal(outcomeOf(skip, [bashCall('git commit -m wip 2>&1', 1)], { fixes }), 'fixed', '2>&1 writes no file');
  assert.equal(outcomeOf(skip, [bashCall('git commit -m wip >/dev/null', 1)], { fixes }), 'fixed', '/dev/null is no file');
  assert.equal(outcomeOf(skip, [bashCall('git commit -m wip > commit.log', 1)], { fixes }), 'unfixed', 'a fix step that writes is a new step');
  assert.equal(outcomeOf(skip, [bashCall('git commit -m wip | tee commit.log', 1)], { fixes }), 'unfixed');
  // A workaround that shares too few words to be similar is still a retry: it hits a veto or a fix signal.
  const build = bashCall('git reset --hard origin/main && npm run build -- --mode site --out dist/site', 0, resetBlock);
  assert.ok(!similar(build.words, words('git fetch && git checkout -B main origin/main')), 'too few words in common to be similar');
  for (const retry of ['git fetch && git checkout -B main origin/main', 'git stash -u && git stash drop && git checkout --detach origin/main', 'git branch -f main origin/main && git checkout -f main', 'git merge --ff-only origin/main && git diff --output=x']) {
    assert.equal(outcomeOf(build, [bashCall(retry, 1)], { fixes }), 'unfixed', retry);
  }
  assert.equal(outcomeOf(reset, [bashCall('git switch --discard-changes -C tmp origin/main', 1)], { fixes }), 'unfixed', '--discard-changes throws away work as -f does');
  assert.equal(outcomeOf(build, [bashCall('npm test -- a.test.ts', 1), bashCall('git push origin feat', 2)], { fixes }), 'none', 'a later fix-like command is other work, not a retry');
  assert.equal(outcomeOf(skip, [bashCall('git commit --no-verif -m wip', 1)], { fixes }), 'unfixed', 'git takes a long option by any unambiguous prefix');
  assert.equal(outcomeOf(skip, [bashCall('git -c core.hookspath=x commit -m done', 1)], { fixes }), 'unfixed', 'git config keys are case-insensitive');
  for (const retry of ['git commit-tree HEAD^{tree} -p HEAD -m done', 'cd .git && rm -r hooks && cd .. && git commit -m done']) {
    assert.equal(outcomeOf(skip, [bashCall(retry, 1)], { fixes }), 'unfixed', retry);
    assert.equal(outcomeOf(skip, [bashCall('git status', 1), bashCall(retry, 2)], { fixes }), 'unfixed', `after git status: ${retry}`);
  }
  assert.equal(outcomeOf(skip, [bashCall('git commit -m wip', 1)], { fixes }), 'fixed', 'the plain commit is still the fix');
  // Review round 2: one harmless command first, then a workaround that shares few words: a veto still catches it.
  for (const retry of ["echo 'exit 0' > .git/hooks/pre-commit && git commit -m 'save work'", 'chmod -x .git/hooks/pre-commit && git commit -m done', 'rm .git/hooks/pre-commit && git commit -m done']) {
    assert.equal(outcomeOf(skip, [bashCall('git status', 1), bashCall(retry, 2)], { fixes }), 'unfixed', retry);
  }
  const hard = bashCall('git reset --hard origin/main', 0, resetBlock);
  assert.equal(outcomeOf(hard, [bashCall('git branch -d fix-main-nav', 1)], { fixes }), 'none', 'main inside a hyphenated branch name is another branch');
  assert.equal(outcomeOf(hard, [bashCall('git branch -D main', 1)], { fixes }), 'unfixed');
  assert.equal(outcomeOf(hard, [bashCall('git branch -m old master', 1)], { fixes }), 'unfixed');
  assert.equal(outcomeOf(hard, [bashCall('git status', 1), bashCall('git checkout -B sync origin/main && git branch -D main && git branch -m main', 2)], { fixes }), 'unfixed', 'a branch swap onto main');
  assert.equal(outcomeOf(hard, [bashCall('git read-tree -u --reset origin/main', 1)], { fixes }), 'unfixed', 'read-tree -u --reset is reset --hard by another name');
  // The round 3 review's retries: each runs beside the named fix, and each is a step of its own.
  for (const step of ['exec 3>.git/hooks/pre-commit', '> .git/hooks/pre-commit', 'uniq /dev/null .git/hooks/pre-commit', 'sort -uo .git/hooks/pre-commit list', 'git diff --output=.git/hooks/pre-commit', 'git -c core.fsmonitor=./x.sh status', 'git fetch --upload-pack=./x.sh']) {
    assert.equal(outcomeOf(reset, [bashCall(`git fetch && ${step} && git merge --ff-only origin/main`, 1)], { fixes }), 'unfixed', step);
  }
  assert.equal(outcomeOf(reset, [bashCall('git fetch && git merge --ff-only origin/main', 1)], { fixes }), 'fixed', 'the same retry without the extra step');
  assert.equal(outcomeOf(reset, [bashCall('git fetch && echo hi > .git/HEAD && git merge --ff-only origin/main', 1)], { fixes }), 'unfixed');
  const echoed = bashCall('echo syncing site && git reset --hard origin/main', 0, resetBlock);
  assert.equal(outcomeOf(echoed, [bashCall('echo syncing site > .git/HEAD && git merge --ff-only origin/main', 1)], { fixes }), 'unfixed', 'a kept step that now writes a file is a new step');
  assert.equal(outcomeOf(echoed, [bashCall('echo syncing site && git merge --ff-only origin/main', 1)], { fixes }), 'fixed', 'the same step, writing nothing new');
  // A fix in one segment cannot excuse a new step beside it, and stash drop is no stash.
  assert.equal(outcomeOf(reset, [bashCall('git fetch origin && git stash -u && git stash drop && git checkout --detach origin/main', 1)], { fixes }), 'unfixed');
  assert.equal(outcomeOf(reset, [bashCall('git fetch origin && git stash && git branch -f main origin/main && git checkout -f main', 1)], { fixes }), 'unfixed');
  assert.equal(outcomeOf(reset, [bashCall('git fetch origin && git stash && git rebase origin/main', 1)], { fixes }), 'unfixed', 'a new step no signal names');
  assert.equal(outcomeOf(mergeLoop, [bashCall('gh pr view 7 -R acme/site --json headRefOid --jq .headRefOid && gh api -X PUT repos/acme/site/pulls/7/merge', 1)], { fixes }), 'unfixed');
});

test('neutral steps fail closed: an allowlisted program, every flag on its list, stdin only, no write', () => {
  const neutral = ['tail -2', 'grep -E "^(pass|fail)|^x"', 'grep -i -E "^(workerd|node)"', 'git status --short', 'git branch --show-current', 'git -C ../x log --oneline -3', 'git diff --stat HEAD 2>/dev/null', 'echo clean', 'echo "exit=${pipestatus[1]}"', "printf '%s\\n' \"578|abc|review: \\`wrangler\\` set\"", 'for n in 74 100', 'do', 'done', 'S=/private/tmp/x', 'head -n 5', 'jq -r .id', 'sort -u', 'wc -l', 'ls -A "$SP"', 'git worktree list', "while IFS='|' read n sha body"];
  for (const step of neutral) assert.ok(neutralStep(step), step);
  const own = ['git worktree add ../x', 'ls -A $(pwd)', 'while read x; do', 'git status --unknown', 'git log -p', 'git -c core.fsmonitor=./x.sh status', 'git fetch --upload-pack=./x.sh', 'git diff --output=x', 'grep -c x quality/selftest.mjs', 'head -n 3 notes.txt', 'grep x < f', 'tail -f log', 'uniq /dev/null OUT', 'sort -uo OUT', 'jq -n env', 'echo x > f', 'echo $(cat f)', 'echo `id`', 'exec 3>f', '> f', 'for f in ${=files}', 'for s in $A $B', 'S=$T', 'PATH=/tmp/x', 'printf -v X y', 'pkill -f x', 'cat f', 'git status | sh'];
  for (const step of own) assert.ok(!neutralStep(step), step);
  const reset = bashCall('git fetch && git reset --hard origin/main', 0, resetBlock);
  assert.equal(outcomeOf(reset, [bashCall('git fetch && git merge --ff-only origin/main 2>&1 | tail -2 && git status --short', 1)], { fixes }), 'fixed', 'the fix with neutral checks beside it');
  assert.equal(outcomeOf(reset, [bashCall('git fetch && git merge --ff-only origin/main && awk 1', 1)], { fixes }), 'unfixed', 'a program off the allowlist');
  assert.equal(outcomeOf(reset, [bashCall('git fetch && git merge --ff-only origin/main && git status --unknown', 1)], { fixes }), 'unfixed', 'an unknown flag');
  assert.equal(outcomeOf(reset, [bashCall('git fetch && git merge --ff-only origin/main | grep -c x notes.txt', 1)], { fixes }), 'unfixed', 'a filter with a file operand');
});

test('false alarm: essentially the same command ran unblocked', () => {
  const push = bashCall('git push origin main', 0, { kind: 'guard', rules: ['git-push-main'] });
  assert.equal(outcomeOf(push, [bashCall('bash -c "git push origin main"', 1)], { fixes }), 'same', 'routed around through bash -c');
  assert.equal(outcomeOf(push, [bashCall('git push origin main', 20)], { fixes }), 'none', 'past 10 minutes it is not this block\'s retry');
});

test('could not read: a block with no command is left out, never a pass or a false alarm', () => {
  assert.equal(outcomeOf(bashCall('', 0, resetBlock), [bashCall('ls', 1)], { fixes }), 'unread');
});

test('steps: a heredoc body stays in the step that opened it, never steps of its own (#215)', () => {
  assert.deepEqual(steps("python3 - <<'EOF'\nimport sys\np = sys.argv[1]\nEOF\ngit status"), ["python3 - <<'EOF' import sys p = sys.argv[1] EOF", 'git status']);
  assert.deepEqual(steps('cat <<-END | wc -l\n\ta; b\n\tEND'), ['cat <<-END', 'wc -l a; b END']);
  assert.deepEqual(steps('echo a <<< b; ls'), ['echo a <<< b', 'ls']);
});

test('signalForm: a timeout, git -C and a discarded redirection do not hide a fix (#215)', () => {
  assert.equal(signalForm('timeout 60 node --test --test-reporter=spec a.test.mjs 2>&1'), 'node --test --test-reporter=spec a.test.mjs');
  assert.equal(signalForm('git -C "$W" merge -q --ff-only origin/main'), 'git merge -q --ff-only origin/main');
  assert.equal(signalForm('gh run cancel 1 >/dev/null 2>&1'), 'gh run cancel 1');
  const sigs = fixSignals(JSON.parse(fs.readFileSync(new URL('../../targets/blockers.json', import.meta.url), 'utf8')).find((t) => t.params?.fix_signals).params.fix_signals);
  assert.ok(sigs.get('local-test-suite').some((x) => x.re.test(signalForm('timeout 60 node --test --test-reporter=spec quality/a.test.mjs 2>&1'))));
  assert.ok(sigs.get('git-reset-hard').some((x) => x.re.test(signalForm('git -C "$W" merge -q --ff-only origin/main'))));
});

test('signalForm: option and -C patterns stay linear on a long run of repeats (#13, js/redos)', () => {
  assert.equal(signalForm('timeout -k 5 -s KILL 60 npm test'), 'npm test');
  assert.equal(signalForm("git -C 'a b' -C x\"y\" status"), 'git status');
  const t0 = Date.now();
  // The old timeout pattern took 23 ms at 12 repeats and doubled with each one more.
  assert.equal(signalForm(`timeout -A${' -A -A'.repeat(40)}x`), `timeout -A${' -A -A'.repeat(40)}x`);
  assert.equal(signalForm(`git -C ${'"" -C '.repeat(40)}x`), 'git -C x');
  assert.ok(Date.now() - t0 < 1000, `40 repeats took ${Date.now() - t0} ms`);
});

test('reviewedPrs: the PR numbers a parallel reviewer\'s Agent call names', () => {
  assert.deepEqual(reviewedPrs('Review PR #394 public scans'), [394]);
  assert.deepEqual(reviewedPrs('Review PRs #391 and #392'), [391, 392]);
  assert.deepEqual(reviewedPrs('Sign-off review for PR 222'), [222]);
  assert.deepEqual(reviewedPrs('Review PRs 1, 2 and 3'), [1, 2, 3]);
  assert.deepEqual(reviewedPrs('Review the hook head'), []);
  assert.deepEqual(reviewedPrs('Review PR #394, fixes issue #12'), [394], 'an issue number is not charged');
  assert.deepEqual(reviewedPrs('Review PRs #391, #392'), [391, 392]);
  assert.deepEqual(reviewedPrs('Summarize #601 CI failure'), []);
});

test('reviewerTokens: a reviewer naming PRs is charged to them, split evenly; one naming none by the merge window', () => {
  const at = (h) => Date.parse('2026-11-03T00:00:00Z') + h * 3_600_000;
  const msgs = (...pairs) => pairs.map(([h, billable]) => ({ at: at(h), billable }));
  const prs = [{ number: 8, mergedAt: new Date(at(3)).toISOString() }, { number: 7, mergedAt: new Date(at(2)).toISOString() }];
  const files = [
    { reviewer: true, reviewPrs: [7, 8], messages: msgs([1, 600], [9, 400]) }, // after the newest merge too: still its PRs' cost
    { reviewer: true, reviewPrs: [99], messages: msgs([1, 500]) }, // a PR outside the last merges
    { reviewer: true, reviewPrs: [], messages: msgs([1, 300], [4, 200]) }, // names none: only up to the newest merge
    { reviewer: false, reviewPrs: [], messages: msgs([1, 900]) },
  ];
  const got = reviewerTokens(files, prs, prs);
  assert.deepEqual([...got.byPr].sort(), [[7, 500], [8, 500]]);
  assert.equal(got.unnamed, 300);
  assert.equal(got.total, 1300);
});
