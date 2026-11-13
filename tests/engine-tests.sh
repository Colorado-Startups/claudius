#!/usr/bin/env bash
# The moved pack against Git Crafter, in CI (ci.yml standard job). No engine code is committed here.
#   1 Fidelity: each file in tests/moved.json matches its Git Crafter path at source_commit, byte for byte.
#   2 Tests: the engine at the ci.yml pin is fetched, each moved file is laid over its Git Crafter path, and
#     the moved *.test.mjs files run there, where their engine imports (../lib, ../github) resolve.
set -euo pipefail
here=$(pwd)
src=$(node -p 'require("./tests/moved.json").source_commit')
pin=$(sed -nE 's|.*SoulCraft-Org/git-crafter/.github/workflows/ci-standard.yml@([0-9a-f]{40}).*|\1|p' .github/workflows/ci.yml)
pages_pin=$(sed -nE 's|.*SoulCraft-Org/git-crafter/actions/pages@([0-9a-f]{40}).*|\1|p' .github/workflows/pages.yml)
if [ -z "$pin" ] || [ "$pin" != "$pages_pin" ]; then echo "::error::ci.yml and pages.yml must pin one engine SHA ($pin, $pages_pin)"; exit 1; fi

eng="${RUNNER_TEMP:-$(mktemp -d)}/git-crafter"
git init -q "$eng"
git -C "$eng" fetch -q --depth 1 https://github.com/SoulCraft-Org/git-crafter "$src"
if [ "$pin" != "$src" ]; then git -C "$eng" fetch -q --depth 1 https://github.com/SoulCraft-Org/git-crafter "$pin"; fi

bad=0
while IFS=$'\t' read -r from to; do
  if ! git -C "$eng" show "$src:$from" | cmp -s - "$to"; then echo "::error::$to differs from Git Crafter $from at $src"; bad=1; fi
done < <(node -e 'for (const [a, b] of require("./tests/moved.json").files) console.log(`${a}\t${b}`)')
if [ "$bad" -ne 0 ]; then exit 1; fi
echo "fidelity: $(node -p 'require("./tests/moved.json").files.length') files match $src"

git -C "$eng" checkout -q --detach "$pin"
npm ci --prefix "$eng" --ignore-scripts --no-audit --no-fund --loglevel=error
tests=()
while IFS=$'\t' read -r from to; do
  mkdir -p "$eng/$(dirname "$from")"
  cp "$to" "$eng/$from"
  case "$from" in *.test.mjs) tests+=("$from") ;; esac
done < <(node -e 'for (const [a, b] of require("./tests/moved.json").files) console.log(`${a}\t${b}`)')
cd "$eng"
node --test "${tests[@]}"
cd "$here"
