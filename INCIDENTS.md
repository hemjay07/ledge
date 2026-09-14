# Incidents — what broke, why the class repeats, and the guard that stops it

Started 2026-09-13, after the owner asked why so many bugs have been caught
in one week and what stops them from reaching users. This file is the honest
answer. Every entry names the class, not just the bug, because a bug fixed
once and a class left open is how the same thing comes back wearing a
different file name.

## The pattern behind the week

Sixteen fixes since 6 September fall into four classes. Two classes account
for most of them.

**Class 1 — the same thing written from two places.** `number.json` had two
authors (crawl.py and recompute.py) that had to be kept in step by hand.
When one learnt a new input the other did not, the reproducibility gate
refused the push — which is the gate working — but the site went stale
until someone noticed. It happened on 2026-09-08 (samples) and again on
2026-09-13 (pools). *Guard now:* the crawl builds the number from the pools
directory exactly as recompute will read it, by recompute's own rules
(`_pools_after_write`), and a test runs the crawl over a copy of the real
committed record and compares — so every shape the record has is
exercised, and the test grows with the record without being edited
(`test_crawl_matches_recompute_on_a_copy_of_the_committed_record`).
*Closed 2026-09-14:* one author. `recompute()` builds `number.json` for
the crawl too, reading the crawl's staged writes through `recompute.Staged`
(the directory as it will be after the commit point), so the crawl holds
no copy of the loading rules any more and the commit guarantee is
unchanged. The two failure-injection tests now stage a failure in
recompute, which is where a stats failure now lives.

**Class 2 — a limit the code assumed and the environment did not honour.**
GitHub's 45-minute job ceiling (swap collection, twice), Cloudflare's free
D1 write quota (720k rows/day), the free-plan subrequest budget (live
coverage at 39%), ordofi's "network is busy" (35 of 36 box runs), a missing
block header (one box run), and ordofi's 75-second `Initialize` query
(runs that would have outlived the 2-hour unit). Each time the fix was a
budget, a retry, a fallback or a cap — correct, but each was found by the
failure. *Guard now (2026-09-14):* one RPC gateway on the box (`gateway/`,
tested against fake upstreams, in CI) owns pacing, failover, retry and
cache for every chain read; the clients hold no endpoint policy any more.
Its `/metrics` line once a minute makes rate-limit pressure a number in
the journal instead of an outage. The crawl's per-window cost is measured
in `INDEXER.md` "RPC"; the runner has a 2-hour ceiling and the crawl a
200-window cap, so a slow endpoint still fails visibly. *Still open (A4):* the watchdog only checks freshness from
GitHub every six hours. The three reconciliation figures — coverage,
agreement, freshness — belong on `/method` hourly, and a Telegram message
when a cursor is past its bound, so the owner learns of a stall in an hour,
not the next morning.

**Class 3 — a test that agreed trivially.** The pinning test for the two
writers used an empty fixture; the vector gate did not cover the outcomes
block until it was moved to the top level; `test_crawl_matches_recompute`
passed while the box was failing. *Guard now:* the committed-record test
above. *Rule from here:* a test that pins two things together must be shown
to fail when they are pulled apart, in the commit that adds it (the
2026-09-13 pool test was run red before the fix; that is the standard).

**Class 4 — a figure wrong by construction, caught by reading it.** The
Worker's fill was off by orders of magnitude on wash-traded curves (summed
flows instead of the reserve); `crawledAt` was the run's clock, not the
chain's; the 7-day dispatch labelled a 29-hour record as 7 days. Each was
caught by a person looking at a number and finding it implausible, which
is the least reliable guard there is. *Guard now:* METHOD.md dated entries
for each, and the reserve is read from the contract. *Rule from here:*
every new published figure ships with a fixture from the real chain (the
pool decoders have two real logs as fixtures; the fill has none yet).

## Why it does not mean users will see this

Most of these never reached a reader: the gate refused the push, the site
showed its stale banner, the Worker's cron caught up. What a reader would
have seen is *staleness* — the banner up for hours — and that is the thing
the box, the fallback, and A4 are for. The bugs that would have shown a
*wrong number* (class 4) were caught before publication in every case but
the fill, which was live for under a day and had no reader depending on it.

The honest statement of where reliability stands, 2026-09-13: the canonical
crawl has been failing more than it has been running for two days, on
infrastructure changes made in that window. The measure that matters is
the one TODO A2 asks for — four consecutive clean timer runs and a full day
without the banner — and it has not been met yet.

## Log

| Date | What | Class | Guard added |
|---|---|---|---|
| 09-06 | closed window counted boundary launches twice | 4 | METHOD entry; half-open windows in code and text |
| 09-07 | `crawledAt` was the run's clock; 24 h window short by 81 min | 4 | chain-time `lastIndexedAt`; METHOD entry |
| 09-07 | dispatch labelled 29 h as "7 days" | 4 | window clamped to record; labels name the span |
| 09-08 | crawl omitted `samples`; gate refused every push | 1 | pinning test (synthetic fixture) |
| 09-10 | Worker fill wrong on wash-traded curves | 4 | Multicall3 reserve read |
| 09-10 | D1 free write quota blown (720k rows/day) | 2 | write-on-change; Workers Paid |
| 09-11 | live coverage 39% on free-plan budgets | 2 | budgets sized to the paid plan |
| 09-12 | swap collection outlived GitHub's 45 min, twice | 2 | swaps removed from the forward crawl; probe is the price source |
| 09-12 | missing block header failed a 35-min box run | 2 | per-block header retry |
| 09-12 | probe points folded as bars | 1 | `POOL_BAR_NAME`; loader test |
| 09-12 | vector gate failed with outcomes under `cohort` | 3 | moved to top level |
| 09-13 | 35 of 36 box runs failed on ordofi "busy" | 2 | fallback endpoint; official endpoint primary |
| 09-13 | ordofi `Initialize` query 75 s/window | 2 | measured; endpoint order swapped; recorded in INDEXER.md |
| 09-13 | crawl built `number.json` without the pools it wrote | 1, 3 | pools view; committed-record test |
| 09-13 | both public RPCs refused Cloudflare's egress; live tick down from 18:05Z | 2 | RPC relay on the box + keyed Worker client (owner flips it) |
| 09-13 | one box push lost a race with a hand push at 19:07Z | — | expected; the runner keeps the commit and pushes next run (it did) |
| 09-14 | official endpoint refused the tick's header batch after ~50 calls/30 s from the box | 2 | the gateway: pacing + failover + cache, one place, tested |
| 09-14 | the box is 1 vCPU / 957 MB / 20 GB, not the 4 GB assumed; OOM killed the probe's recompute beside the gateway (218 MB cache) and a crawl | 2 | 2 GB swap; gateway cache bounded by bytes (32 MB), not entries; box size written in ops/README.md; probe and crawl not to overlap (open) |
| 09-14 | both boards printed `count` (the 200-row cap) as the population; the graveyard's headline figure was the cap | 4 | `total` beside `count` on both responses; the site says "200 of 55,385" |
| 09-14 | the bot's reply was rewritten; the site's lookup panel walks that text by line order and mis-slotted it for ~1 h | 1 | walker follows the new order; fixtures re-rendered by the Worker's own builder; run the site suite after any text.ts change |
| 09-14 | one empty header in a 50-block batch failed seven box ticks in a row | 2 | per-block retry in the tick (as the crawl has had since 09-12) |
| 09-14 | the box runner ignores SIGTERM; every restart waits 90 s for SIGKILL | 2 | open: handle the signal in worker/host/main.ts |
