#!/usr/bin/env bash
# scripts/lint-worker.sh
#
# Gates 2 and 3 of ARCHITECTURE-PHASE2-4.md section 9, as a script a reviewer
# can read in the CI log. worker/tests/node/lint.test.ts runs the identical
# checks inside the suite; both exist because this one is legible from the
# workflow file and that one fails in the same place everything else fails.
#
# Gate 2 — the no-arithmetic lint. worker/src/{lookup,ladder,text}.ts may read
# numbers and format strings and do nothing else. No rate, share or percentile
# is ever computed in TypeScript: pipeline/stats.py is the only place a
# statistic is defined. Formatting helpers that genuinely need division live in
# worker/src/format.ts, which carries a reviewer note saying so.
#
# Gate 3 — the key-name lint. No field and no sentence may name a verdict.
#
# Exits 1 and prints the offending lines if anything matches.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d worker/src ]; then
  echo "lint-worker: worker/src not present yet, nothing to check"
  exit 0
fi

FAIL=0

# ---- gate 2 -----------------------------------------------------------------
GUARDED=(worker/src/lookup.ts worker/src/ladder.ts worker/src/text.ts)
# Deliberately blunt. ' / ' catches division with its conventional spacing;
# anything that needs it belongs in format.ts.
ARITHMETIC='Math\.round|toFixed|percentile|reduce\(| / '

for file in "${GUARDED[@]}"; do
  [ -f "$file" ] || continue
  if grep -nE "$ARITHMETIC" "$file"; then
    echo "lint-worker: $file computes. Statistics are defined in pipeline/stats.py only."
    FAIL=1
  fi
done

# ---- gate 3 -----------------------------------------------------------------
VERDICT='score|risk|odds|probab|predict|will '
if grep -rnIE "$VERDICT" worker/src; then
  echo "lint-worker: a verdict word reached the Worker's source."
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "lint-worker: clean"
exit 0
