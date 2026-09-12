#!/usr/bin/env bash
# The canonical crawl, on the box. INDEXER.md §1.
#
# The same sequence .github/workflows/crawl.yml ran, moved to a machine whose
# clock we own: pull, crawl, recompute --check, commit, push -- with the same
# push-race resolution the workflow used (number.json is generated; a conflict
# there has one correct answer, recompute against the merged partitions).
#
# Two guarantees the box adds that GitHub could not:
#   - one run at a time, ever (flock), so two runs cannot race each other;
#   - no 45-minute ceiling, so a catch-up after an outage finishes instead of
#     being killed with its data uncommitted (that happened twice on
#     2026-09-12).
set -euo pipefail

REPO="${LEDGE_REPO:-$HOME/ledge}"
LOCK="${LEDGE_LOCK:-/tmp/ledge-crawl.lock}"
LOG_TAG="ledge-crawl"

log() { echo "$(date -u +%FT%TZ) $LOG_TAG: $*"; }

exec 9>"$LOCK"
if ! flock -n 9; then
  log "another run holds the lock; skipping"
  exit 0
fi

cd "$REPO"

# Start from a clean tree on main. A leftover rebase from a killed run must
# not poison this one.
git rebase --abort >/dev/null 2>&1 || true
git checkout -q main
git fetch -q origin main
git reset -q --hard origin/main

log "crawl starting"
.venv/bin/python pipeline/crawl.py
log "recompute --check"
.venv/bin/python pipeline/recompute.py --check

git add data
if git diff --cached --quiet; then
  log "no data change"
  exit 0
fi
git commit -q -m "data: crawl $(date -u +%Y-%m-%dT%H:%MZ)"

for attempt in 1 2 3; do
  git fetch -q origin main
  if git rebase -q origin/main; then
    :
  elif [ -f data/number.json ]; then
    git checkout --ours data/number.json && git add data/number.json
    GIT_EDITOR=true git rebase --continue || { git rebase --abort || true; sleep 5; continue; }
  else
    git rebase --abort || true; sleep 5; continue
  fi
  # recompute against whatever partitions the rebase brought in, so the
  # published figures always match the committed record
  .venv/bin/python pipeline/recompute.py
  git add data/number.json
  git diff --cached --quiet || git commit -q --amend --no-edit
  if git push -q origin main; then
    log "pushed $(git rev-parse --short HEAD)"
    exit 0
  fi
  log "push rejected (attempt $attempt)"
  sleep 5
done

log "push failed after 3 attempts; data stays committed locally for the next run"
exit 1
