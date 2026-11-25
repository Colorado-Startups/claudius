#!/usr/bin/env bash
# The person's own terms file, in the folder the hook reads. The term is made up and lives on example.com.
set -euo pipefail
mkdir -p "$HOME/.claude/claudius-guard"
printf '# made-up term\nacme-widgets.example.com\n' > "$HOME/.claude/claudius-guard/private-terms.txt"
