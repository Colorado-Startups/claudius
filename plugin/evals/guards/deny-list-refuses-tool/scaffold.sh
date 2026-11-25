#!/usr/bin/env bash
set -euo pipefail
mkdir -p .claude
printf '{"tools":["Write"],"reason":"This repo is read only."}\n' > .claude/claudius-deny.json
