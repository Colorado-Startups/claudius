#!/usr/bin/env bash
# The moved pack against Git Crafter, in CI (ci.yml standard job). No engine code is committed here.
#   1 Fidelity: each file in tests/moved.json matches its Git Crafter path at source_commit, byte for byte,
#     unless it is in edited; an edited file still has its source there, and differs from it.
#   2 Tests: the engine at the ci.yml pin is fetched beside this checkout, and the pack's *.test.mjs files run
#     here, given the engine's lib (tests/engine-lib.mjs, GIT_CRAFTER), as collect.mjs gives each collector.
set -euo pipefail
src=$(node -p 'require("./tests/moved.json").source_commit')
pin=$(sed -nE 's|.*SoulCraft-Org/git-crafter/.github/workflows/ci-standard.yml@([0-9a-f]{40}).*|\1|p' .github/workflows/ci.yml)
pages_pin=$(sed -nE 's|.*SoulCraft-Org/git-crafter/actions/pages@([0-9a-f]{40}).*|\1|p' .github/workflows/pages.yml)
if [ -z "$pin" ] || [ "$pin" != "$pages_pin" ]; then echo "::error::ci.yml and pages.yml must pin one engine SHA ($pin, $pages_pin)"; exit 1; fi

eng="${RUNNER_TEMP:-$(mktemp -d)}/git-crafter"
git init -q "$eng"
git -C "$eng" fetch -q --depth 1 https://github.com/SoulCraft-Org/git-crafter "$src"
if [ "$pin" != "$src" ]; then git -C "$eng" fetch -q --depth 1 https://github.com/SoulCraft-Org/git-crafter "$pin"; fi

bad=0
while IFS=$'\t' read -r from to edited; do
  if ! git -C "$eng" cat-file -e "$src:$from" 2>/dev/null; then echo "::error::$to: Git Crafter $from is not at $src"; bad=1
  elif [ "$edited" = 1 ] && git -C "$eng" show "$src:$from" | cmp -s - "$to"; then echo "::error::$to is in edited but matches $from at $src"; bad=1
  elif [ "$edited" = 0 ] && ! git -C "$eng" show "$src:$from" | cmp -s - "$to"; then echo "::error::$to differs from Git Crafter $from at $src; list it in edited"; bad=1; fi
done < <(node -e 'const m = require("./tests/moved.json"); for (const [a, b] of m.files) console.log(`${a}\t${b}\t${m.edited.includes(b) ? 1 : 0}`)')
node -e 'const m = require("./tests/moved.json"); const to = new Set(m.files.map((f) => f[1])); for (const e of m.edited) if (!to.has(e)) { console.log(`::error::edited ${e} is not a moved file`); process.exitCode = 1; }' || bad=1
if [ "$bad" -ne 0 ]; then exit 1; fi
echo "fidelity: $(node -p 'const m = require("./tests/moved.json"); `${m.files.length - m.edited.length} files match ${m.source_commit}, ${m.edited.length} edited`')"

git -C "$eng" checkout -q --detach "$pin"
npm ci --prefix "$eng" --ignore-scripts --no-audit --no-fund --loglevel=error
GIT_CRAFTER="$eng" node --import ./tests/engine-lib.mjs --test collectors/*/*.test.mjs
