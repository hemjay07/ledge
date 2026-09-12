# Outcomes, step 3: the statistics, behind the recompute gate. 2026-09-12.

Repo `/Users/mujeeb/ledge`. Read `OUTCOMES.md` (§"What is computed" is the
spec, §"What has been proven" is what steps 1–2 built), `CONSTRAINTS.md`
(clauses 1, 3, 4, 5, 9 bind hardest here), `METHOD.md`, `pipeline/stats.py`
in full (this is Class A code: every statistic on the site is computed here
and nowhere else), `pipeline/recompute.py`, `pipeline/tests/test_stats.py`,
and `pipeline/pool.py` + the `data/pools/` writers in `pipeline/crawl.py`
from step 2.

## What this step does

Turn the hour bars into cohort statistics, publish them in `number.json`,
and write the dated `METHOD.md` entry that `CONSTRAINTS` 9 requires before
any of it may be shown. **No site or worker changes** — the surfaces are
step 4.

## Build

1. **`pipeline/stats.py`** — a new `outcomes(...)` block, computed from
   `data/pools/` joined to graduations by token:
   - For each graduation that has a pons pool: `openingPrice` (the pool's
     own `Initialize` price), then for each mark in +1 h, +24 h, +7 d:
     `priceAt` = the **close of the last hour bar at or before the mark**;
     `changeAt` = `priceAt / openingPrice − 1`.
   - **No bar at or before a mark is its own outcome**, counted as
     `noTrade` — never a price of 0, never dropped from n.
   - A mark that has not yet elapsed for a graduation is **not counted
     toward that mark's n at all** (it is not `noTrade`).
   - A graduation whose pool has null prices (unknown decimals) is counted
     in `withoutPrice` and excluded from the medians, with its own count
     published — never silently dropped (CONSTRAINTS 5).
   - Cohorts, each independently: by **time-to-graduation bucket** (reuse
     the existing descriptive marks — under 10 s, 10 s to 5 min, over
     5 min; do not invent new edges), by **pair token**, by **creator tax
     band** (reuse `_bucket_key`).
   - Per cohort and mark publish: `n`, `noTrade` count and share,
     `withoutPrice`, `median`, `p25`, `p75` of `changeAt`. Medians and
     quartiles, never means.
   - **n < 30 → `insufficient: true` and every quantile null**, exactly as
     `ttg_percentiles` and `cohort` already do. Follow the existing
     insufficiency convention rather than a new one.
   - Determinism: the whole file must be byte-stable. Use the same
     rounding and serialisation conventions the surrounding code uses
     (`canonical_dumps`); decimals arrive as strings from step 2, so parse
     with `decimal.Decimal`, never float, and round once at the end.

2. **`pipeline/recompute.py`** — read the pool partitions the same way it
   reads launches and graduations, and pass them into the new block. The
   `--check` gate must still pass: run it and confirm it exits 0 with the
   regenerated file matching.

3. **`site/lib/schema.ts`** — add the new block as **optional** so a
   `number.json` written before this change still validates (the site is a
   separate deploy and will see both). Do not render anything yet; do not
   touch any page. Mirror the shape exactly. Run `cd site && npm test`.

4. **`METHOD.md`** — a dated entry (2026-09-12) that states, in the file's
   own voice: what an outcome is, where the price comes from (v4 `Swap`
   logs, `sqrtPriceX96`, quote per token), the three marks, that `noTrade`
   is an outcome rather than a gap, that a mark not yet elapsed is not
   counted, that unknown-decimals pools are excluded and counted, that
   medians and quartiles are published rather than means and why, and the
   n = 30 floor. It must also say plainly that **these figures describe
   populations, never a token**, and that nothing here predicts anything.

## Tests — `pipeline/tests/test_outcomes_stats.py` (new)
Offline, fixtures only:
- a graduation with bars either side of a mark takes the close at or
  before it, not the nearest;
- a graduation with no bar before a mark counts as `noTrade`;
- a mark that has not elapsed is absent from n entirely;
- a null-price pool lands in `withoutPrice` and not in the medians;
- n = 29 prints `insufficient` with null quantiles, n = 30 prints figures;
- median/p25/p75 against a hand-computed set;
- byte-stability: computing twice gives an identical string.

`.venv/bin/pytest pipeline/tests -q` green, `python pipeline/recompute.py
--check` exit 0, `cd site && npm test` green, `bash scripts/lint-copy.sh`
clean.

## Expect small n, and say so
Only about a day of pool data exists, so most cohorts will print "not
enough data (n=…)". That is the correct starting state and must not be
worked around — the backfill (step 5) is what fills n.

## Report
✅ DONE / 📋 PLANNED. The shape of the new block. What `--check` said. The
n it actually produced per cohort today. Do not commit. Do not touch
`worker/`, any page under `site/app`, or `data/` by hand.
