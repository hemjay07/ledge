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
