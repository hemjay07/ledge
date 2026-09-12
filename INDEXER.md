# The indexer moves to a box we control

Written 2026-09-12. Status: **plan**. Nothing here is built.

## Why

Measured today:

- The canonical crawl (`pipeline/crawl.py`, GitHub Actions, cron `7 * * * *`)
  actually ran at 09:35, 14:21, 18:25, 21:40, 00:12 — every 2.5 to 5 hours.
  GitHub delays scheduled runs under load. `staleAfterSeconds` is 7,200, so
  the red banner is up most of the day for a crawl that is "hourly" in name.
- The live layer (the Worker's one-minute tick into D1) holds **14,567
  launches over 7 days** against **17,517 launched in the last 24 hours**
  by the canonical record: about **12% coverage**. Causes, all structural to
  running an indexer inside a Cloudflare Worker: 50 outbound requests per
  invocation, both public RPCs rate-limiting Cloudflare egress, and the
  jump-to-head recovery that drops what it skipped.
- D1 free plan: 100,000 row writes a day. The reserve read alone was
  720,000. Fixed to write-on-change, but ~430 tokens trade per hour, so the
  base fold is near the cap on its own.

The site is honest about all three in captions. That is not the same as
being right. Every live surface — `/live`, `/graveyard`, the NOW card, "launch
not indexed" on `/t/{address}`, and the post-graduation outcomes we intend to
collect — stands on this layer.

## What runs where, after

| | Today | After |
|---|---|---|
| Canonical crawl (stats) | GitHub Actions, drifting | **VPS**, systemd timer every 10 min |
| Live index (launches, trades, reserves) | Worker cron, 12% coverage | **VPS**, the same TypeScript tick under Node, continuous |
| API (`/api/*`, `/t/*`) | Worker + D1 | Worker + D1, unchanged — serving only |
| Publish (KV number.json, oracle) | GitHub Actions after crawl | GitHub Actions, triggered by the data push |
| Site | Vercel on push | unchanged |

One box, one RPC connection per process, no per-invocation budget, no
scheduler drift.

**Box.** Hetzner CX22 (2 vCPU, 4 GB, ~€4/month) or DigitalOcean $6 droplet.
Ubuntu 24.04. Nothing else on it.

**RPC.** `rpc.ordofi.network` primary, `rpc.mainnet.chain.robinhood.com`
fallback — same as now, but from one steady process rather than bursts of
50. If either still rate-limits a single client, the next step is our own
node (Robinhood Chain is an Arbitrum Orbit chain; ~$20–40/month box). Not
before it is shown to be needed.

## The four pieces

### 1. Canonical crawl on a timer (half a day)

`pipeline/crawl.py` → `recompute.py --check` → `git commit` → `git push`,
exactly the sequence `.github/workflows/crawl.yml` runs, as a systemd
service + timer every 10 minutes with a lock so two runs never overlap. A
deploy key with write access to the repo, scoped to this one box.

`crawl.yml` loses its `schedule` and gains `on: push: paths: [data/**]`, so
the KV publish and oracle jobs still run on every data commit, from GitHub,
with the secrets staying there. `workflow_dispatch` stays as the manual
fallback.

`staleAfterSeconds` drops from 7,200 to 1,800: a claim of "hourly" that
allows two hours of silence is not the claim the banner should defend.

### 2. Live index on the box (one to two days)

The Worker's tick (`worker/src/tick.ts` and everything it imports) runs
under Node on the VPS, unchanged, against two shims:

- `db`: the D1 REST API (`/accounts/{id}/d1/database/{id}/query`) behind the
  same `prepare/bind/run/all/batch` surface the tick already uses. Batches
  stay batches. One API token, D1 write scope only.
- `RpcClient`: the same class with `SUBREQUEST_BUDGET` raised by env — the
  budget was Cloudflare's limit, not ours.

Runs as a systemd service in a loop: tick, sleep to the next 10 seconds,
tick. `BLOCKS_PER_TICK` stays 600 as the catch-up cap; in steady state a
tick covers ~100 blocks. `MAX_RECOVERABLE_GAP` stays as the last resort but
should never fire: an outage of hours is caught up at 600 blocks a tick.

The Worker's `[triggers] crons` is removed. The Worker serves; it no longer
indexes. Its tests keep running — they test the code the box now runs.

**Why not rewrite the tick in Python and have one language on the box.** The
TypeScript tick has 383 tests and the Class A/B split is enforced on it by
`scripts/lint-worker.sh`. A port is a second implementation of counts that
must agree with the first, which is the vector-gate problem all over again.
Same code, different host, is the smaller change.

### 3. Reconciliation, published (half a day)

An hourly job on the box, results written to KV and shown on `/method`:

- **Coverage.** Sample 200 launches from the canonical partitions of the
  last 24 hours; count how many have a `token_activity` row. Publish
  `live layer coverage: 99.2% of 200 sampled launches (last 24 h)`. Below
  97% pages the owner.
- **Agreement.** Sample 25 curves from the board; read `realQuoteReserve()`
  fresh; compare to the stored `reserve_wei`. Publish the share that agree
  within one tick's worth of trades and the largest disagreement.
- **Freshness.** Age of the live cursor and of `number.json`, both.

These are Class B counts about our own index, not statistics about pons,
so they live outside `pipeline/stats.py` and the recompute gate; they are
published with n like everything else.

### 4. Cutover (an hour, one evening)

1. Box provisioned, deploy key added, `RPC_URL` and the D1 token in
   `/etc/ledge/env` (mode 600, never in the repo).
2. Timer for the crawl started; one run observed to commit and push; the
   GitHub publish jobs observed to run on that push. Then `schedule` removed
   from `crawl.yml`.
3. Live service started **while the Worker cron still runs**; both write the
   same rows for one hour (the fold is idempotent on the overlap). Coverage
   check run. Then the Worker cron removed and the Worker redeployed.
4. `staleAfterSeconds` lowered. Banner watched for a day.

Rollback at any step is the reverse: the Worker cron and the GitHub schedule
are one commit away.

## Reliability: what actually broke, and what fixes each

Measured on 2026-09-12, the day this was written:

| What happened | Why | Fixed by |
|---|---|---|
| No crawl between 05:41 and 09:28 UTC — four hours on an hourly cron | GitHub's scheduler does not guarantee a `schedule:` run fires; under load it skips or defers them | The box: a systemd timer fires locally, from a clock we own |
| A manual run sat queued 8 minutes before starting | Hosted runners are a shared queue | The box: the process is already running |
| The 05:41 scheduled run failed outright | It raced a manual run; both committed `data/`, and the loser could not rebase `data/state.json` | The box: one service, one checkout, one lock — two runs cannot overlap |
| The banner said "2 h old" for most of the day | `staleAfterSeconds` is 7,200, so the site tolerates two hours of silence before it says anything | Dropping it to 1,800 once the timer is reliable |

**What the box does not fix, and what covers it.** One box is one point of
failure: it can be rebooted, run out of disk, or lose its network. Three
things cover that, and all three are part of this plan, not extras:

1. `Restart=always` on both units, so a crash is a five-second gap.
2. **The watchdog.** The reconciliation job (section 3) already runs hourly
   and knows the age of both cursors. If either is older than its bound it
   posts to the owner's Telegram — the same bot the graveyard uses. A
   silent indexer is the failure mode that costs credibility, so the
   alarm is not optional and is built with the indexer, not after it.
3. **Nothing is lost, only delayed.** The canonical record is a git
   repository and the crawl is resumable from its own cursor: a box that
   is down for six hours catches up when it returns, and the only visible
   consequence is the stale banner, which is the honest thing to show.

**The GitHub workflow is not deleted.** It keeps `workflow_dispatch`, so if
the box is gone the crawl can be run from a browser on a phone. That is the
fallback, and it is one click.

## Cost

~$5/month for the box. Cloudflare Workers Paid ($5/month) is needed
regardless for D1 write volume. No other spend.

## What this does not do

- Does not change any published statistic or definition (CONSTRAINTS 9).
- Does not make the live layer retroactive: launches the Worker missed
  before the cutover stay missed in D1. The canonical record has them; the
  per-token page already says "launch not indexed" honestly for those, and
  the coverage figure states the gap from the day it is measured.
- Does not touch the recompute gate, the vector gate, or the lint.

## DONE means

Coverage ≥ 99% of sampled launches for seven consecutive days, the banner
not raised in that time, and the coverage, agreement and freshness figures
on `/method` with their n.
