#!/usr/bin/env bash
# The outcomes backfill probe, on the box. OUTCOMES.md step 5.
#
# Runs pipeline/backfill_pools.py in its OWN clone (~/ledge-probe), so a
# multi-hour probe never holds the crawl's checkout or its lock. It writes
# only data/pools/index-backfill.jsonl and data/pools/backfill.jsonl, then
# regenerates number.json -- the recompute gate in CI and in the crawl runner
# both require number.json to match the record, and a push that changed the
# record without it would go red everywhere -- and pushes with the same
# race resolution the crawl uses.
#
# Resumable: the probe skips (pool, mark) pairs already in backfill.jsonl,
# so killing it and starting again loses at most the batch in flight.
set -euo pipefail

REPO="${LEDGE_PROBE_REPO:-$HOME/ledge-probe}"
LOCK="${LEDGE_PROBE_LOCK:-/tmp/ledge-probe.lock}"
LIMIT="${LEDGE_PROBE_LIMIT_POOLS:-}"
LOG_TAG="ledge-probe"

log() { echo "$(date -u +%FT%TZ) $LOG_TAG: $*"; }

exec 9>"$LOCK"
if ! flock -n 9; then
  log "another probe holds the lock; skipping"
  exit 0
fi

cd "$REPO"
git rebase --abort >/dev/null 2>&1 || true
git checkout -q main
git fetch -q origin main
git reset -q --hard origin/main

log "probe starting${LIMIT:+ (limit ${LIMIT} pools)}"
if [ -n "$LIMIT" ]; then
  .venv/bin/python -m pipeline.backfill_pools --data-dir data --limit-pools "$LIMIT"
else
  .venv/bin/python -m pipeline.backfill_pools --data-dir data
fi

log "recompute"
.venv/bin/python pipeline/recompute.py
git add data/pools data/number.json
if git diff --cached --quiet; then
  log "nothing new"
  exit 0
fi
git commit -q -m "data: outcomes probe $(date -u +%Y-%m-%dT%H:%MZ)"

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
log "push failed after 3 attempts; the probe's output is committed locally and will go with the next push"
exit 1
