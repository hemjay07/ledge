# LEDGE — method

This is the source for the public `/method` page. Definitions here are binding on the crawler, the stats engine, the site copy, and the tests.

## Source

- Chain: Robinhood Chain (chain id 4663, Arbitrum Orbit).
- Contract: PonsV2LaunchFactory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (verified on Blockscout, no proxy).
- Events read:
  - `TokenLaunched(token indexed, curve indexed, deployer indexed, pairToken, launchConfigId, graduationThreshold)` — topic0 `0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607`
  - `PoolGraduated(token indexed, positionId, tokenAmount, pairTokenAmount)` — topic0 `0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259`
- View read per launch: `getLaunchedToken(token)` → field [8] `creatorTaxBps`, field [4] `pairToken`, field [10] `phase`.
- Timestamps come from block headers (`eth_getBlockByNumber(...).timestamp`), never from a blocks-per-second conversion.
- RPC: `https://rpc.mainnet.chain.robinhood.com`, log queries in ≤1,000-block windows, ≤10k logs per query, with retry and backoff. Batch JSON-RPC is allowed.

## Definitions

- **Launch**: one `TokenLaunched` event from the factory. Counted at its block timestamp.
- **Graduation**: one `PoolGraduated` event from the factory for a token that has a recorded launch. Counted at its block timestamp. A graduation for a token with no launch in our records is kept in the raw data but excluded from every rate (it cannot have a denominator).
- **Time to graduation**: graduation timestamp − launch timestamp, in seconds.
- **Fast graduation**: time to graduation < 300 seconds. This is a descriptive threshold, chosen because 67% of graduations in the first 20 hours completed inside it and 44% inside 60 seconds — faster than any organic discovery plausibly allows. It is not a claim about any individual token.
- **Window convention**: every window is the half-open interval `[since, until)` on launch timestamps — a launch at exactly `since` is inside, a launch at exactly `until` is the first launch of the next window. Adjacent windows therefore partition the timeline and no launch is counted twice at the seam. `until` is the run's `crawledAt`; all-time is `since = null`.
- **The Pons Number (24h)**: graduations of launches whose launch timestamp falls in `[crawledAt − 86400, crawledAt)`, divided by launches in that window. A graduation counts for its launch whenever it happens, including after `until`. Because a launch near the end of the window may still graduate, the number is a lower bound for the most recent hours; the page says so.
- **Excluding fast graduations (24h)**: same denominator; numerator excludes fast graduations. Shown beside the Pons Number, never instead of it. Also displayed as "1 in N" where N = round(1 / rate).
- **All-time**: same two rates over every launch since the first block LEDGE indexed. `number.json` records both that block (`firstIndexedBlock`) and the timestamp of the earliest launch in the record (`firstIndexedAt`), so coverage can be stated in hours without converting block numbers to time — a conversion this method forbids everywhere else. Before anything is indexed, `firstIndexedAt` is `null`.

## Precision

Rates are printed to the precision the sample supports: two decimals at n ≥ 1,000, one decimal below, and "not enough data (n=…)" under 30. A bucket that recorded no graduations prints the count it observed ("0 of 244") rather than "0.0%", which would read as a measured finding rather than an absent one.

## Cohorts (all with n; n < 30 renders as "not enough data")

The n < 30 rule applies to **every** published proportion, not only cohort rates: the share of graduations under 300 s and under 60 s, and both deployer shares. Below 30 the share is `null` with `insufficient: true` — never `0.0`, which would read as a measured finding rather than an absent one.

- **Pair token**: three buckets — ETH (`pairToken == 0x0`), stablecoin, tokenized stock/other. Bucket assignment uses the pair token contract's `symbol()`; the mapping table is public in the repo and any unknown symbol lands in "other" until classified.
- **Creator tax**: 0%, 1%, 2–3%, 4–5%, 6–10% (`creatorTaxBps` from `getLaunchedToken`).
- **Hour of day (UTC)**: 24 buckets by launch timestamp.
- **Day of week (UTC)**: 7 buckets; renders "not enough data" until every bucket has n ≥ 30.
- **Pair token x creator tax**: the two cohorts above crossed — 4 pair classes x 5 tax buckets, 20 cells, every cell published with its own n whether or not it can be printed. Most cells are under 30 launches and render "not enough data (n=…)"; that is the honest state of the measurement, not a gap. Each cell also carries the same rate excluding graduations inside 5 minutes, gated on the same n. A launch whose creator tax we could not read, or whose tax falls outside the documented range, has no cell and is counted in the cell grid's excluded total, exactly as it is in the one-dimensional tax cohort.
- **Deployers (aggregate only)**: distinct deployers in window; share that launched 2+; share of launches from deployers with 10+; distribution of launches-per-deployer as a histogram. No addresses.

## Time-to-graduation distribution

Percentiles p10 / p25 / p50 / p75 / p90 / p95 / max of time to graduation, over the same window as the rate shown. Rendered as a horizontal bar with those ticks. Copy: "9 in 10 graduations happened within {p90}". No boundary claims ("nothing after X") are made.

### The ladder

Beside the percentiles, the same distribution is published as a step table at eleven fixed second marks:

`30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600`

Each rung carries the raw count of graduations that completed in **strictly less** than that many seconds, and that count as a share of the window's matched graduations. Strictly-less is the same convention as the 5-minute cutoff, so the rung at 300 s is the share that graduated inside 5 minutes and the rung at 60 s is the share inside 60 seconds — the ladder and those two figures cannot disagree.

The counts only rise as the marks rise. The raw count is always published, so any share can be checked against it. Below 30 matched graduations the whole distribution is insufficient and every rung's share is `null` — the counts still say what was observed.

A graduation slower than the last mark belongs to no rung, so the last count can be below n. Nothing is claimed about that tail beyond `max`.

The marks are a definition. They exist so that anything asking "where does this elapsed time sit" reads a row out of the table rather than computing a percentage of its own; every published share comes from `pipeline/stats.py` and nowhere else. Moving a mark is a dated entry below.

## Freshness

- The crawler runs hourly. Each run records `crawledAt` and `headBlock`.
- **`crawledAt` is chain time, not clock time.** It is the block timestamp of the last block LEDGE indexed (`headBlock`), read from that block's header like every other timestamp here — never the wall clock of the machine that ran the crawl. A window closing at a wall clock reaches past the chain LEDGE has actually read: those minutes hold no launches because they were never scanned, and every rate computed over them is divided by a denominator that is missing them. The crawl records the instant in `state.json` as `lastIndexedAt`; `recompute.py` reads it straight back as `crawledAt`.
- **A run that indexes nothing new does not move it.** `crawledAt` advances only when the cursor advances. A backwards backfill, which extends the record into older blocks and leaves the cursor alone, leaves `crawledAt` exactly where it was.
- Every rendered figure shows "updated {age} ago" computed from `crawledAt`.
- **Age is the consumer's computation, not a field.** `number.json` is a static file and cannot age its own contents. Any consumer — the page, the card, a third party reading `/number.json` — computes `now − crawledAt` and compares it to the published `staleAfterSeconds` (7200). If `crawledAt` is older than that at render time, the page shows the stale banner.
- `lastRunAt` and `lastSuccessAt` in `state.json` stay wall-clock times. They answer one question — did the run that wrote this file know it was already behind — and feed the `stale` flag below. They are never published as `crawledAt`.
- **`stale` in the file means one thing: the run that generated the file knew it was already behind** — it recorded a failure since its last success (`consecutiveFailures > 0`, or `lastRunAt` after `lastSuccessAt`, or no successful run yet). A successful run publishes `stale: false` however old the data later becomes. A failed run commits nothing at all, so `crawledAt` simply ages and the banner appears from the age computation above.

## Reproducibility

- Raw data: `data/launches/YYYY-MM-DD.jsonl` (one line per launch: token, curve, deployer, pairToken, pairClass, creatorTaxBps, block, ts) and `data/graduations/YYYY-MM-DD.jsonl` (token, block, ts, pairTokenAmount).
- Computed: `data/number.json` — every figure on the site, with its n and window.
- `scripts/recompute.py` regenerates `number.json` from the raw files with no network access. CI runs it and diffs against the committed file; a mismatch fails the deploy.
- Anyone can run the same script against the same files and get the same numbers.

## Changelog of definitions

- 2026-09-10 — no new figure and no definition changed. This entry records an **analysis whose result was weaker than it first appeared**, because the figures it concerns are already published on `/cohorts` and a reader is owed what is known about them.

  The question was whether the hour of day a launch is made relates to whether it graduates. Across 143,899 launches in hours with at least 200 launches each, the rate excluding graduations that completed inside five minutes ranges from 1.03% in the 02:00 UTC hour, one in 97, to 0.43% in the 23:00 hour, one in 232. That is a spread of about 2.4 times, and the two extremes are further from the pooled rate of 0.68% than sampling alone at that rate would ordinarily produce. By day of week the spread is about 1.7 times, from 0.86% on Sunday to 0.52% on Tuesday.

  **Three things then made it much less useful than that sounds, and all three are the reason no "when to launch" page was built.**

  First, ranking the hours by raw graduation rate and by the rate excluding fast graduations produces almost unrelated orderings: the rank correlation between them is 0.15 across the 24 hours. The 23:00 hour has one of the *highest* raw rates and the *lowest* organic rate. Any reading taken from raw hourly rates, here or anywhere else, is therefore close to uninformative about organic outcomes.

  Second, the obvious mechanism does not carry it. Launch volume per hour correlates with the organic rate at about −0.46, so crowding accounts for roughly a fifth of the variation. Pooling the twelve quietest hours against the twelve busiest gives one in 140 against one in 152, a difference far too small to act on.

  Third, and decisively: this is an association in a record of what was launched, not a mechanism. It may reflect *who* launches at 02:00 rather than anything about 02:00. Nothing here separates the hour from the population of deployers active in it, and the site does not have the data to.

  So the hourly and daily cohorts stay exactly where they are on `/cohorts`, each carrying its own n, described as what launches made in that hour did. They are not presented as a choice a launcher should make, and no page ranks hours as better or worse to launch in. Publishing a 2.4-times figure as guidance would be a prediction wearing a denominator, which CONSTRAINTS 1 forbids and which the evidence above does not support.

- 2026-09-10 — one new published figure, no existing definition changed: the **distribution of times to graduation**, in fourteen buckets that each roughly double the last, published as `allTime.ttg.histogram` and `h24.ttg.histogram` beside the ladder that was already there. The edges are 0, 2, 5, 10, 20, 40, 80, 160, 320, 640, 1,280, 2,560, 5,120 and 10,240 seconds; the last bucket is open-ended and holds everything slower. Each bucket is half-open, `[fromSeconds, toSeconds)`, the same convention the windows use, so a graduation landing exactly on an edge belongs to the bucket above and is never counted twice. The buckets therefore sum to `n`, which is what separates this from the ladder: the ladder's last rung can sit below `n` because graduations slower than its final mark are counted in no rung, and that is correct there. Moving any edge here moves a published figure and takes its own entry, exactly as moving a ladder mark does.

  Why doubling rather than equal width: graduation times run from under a second to over four days, so on an equal-width axis effectively the whole record is one bar and the drawing says nothing. Why the first edge is 0 rather than 1: a launch and a graduation in the same block differ by zero seconds, and a first bucket that could not hold them would omit the case the figure most exists to show.

  What it showed, measured 2026-09-10 over 2,474 graduations that have a launch on record: the distribution is not one hump but two, with a trough between them. 158 graduations completed in under two seconds and 96 in the two-to-five-second bucket above it, while the broad hump peaks at 285 in the 160-to-320-second bucket. The counts are published with every bucket so the shape can be checked against the numbers.

  What it does not say: it describes how long graduations took and nothing else. No bucket is a label, none is coloured differently from any other, and the 5-minute mark's rule applies to every edge on it — these are descriptive thresholds and never a definition of "rigged". A reader draws their own conclusion from a two-second graduation; the site does not draw it for them.

  Also recorded here because it is a finding that did not survive: a proposed figure counting **which second of the minute** graduations fall in was computed and rejected before publication. Over 2,465 graduations the chi-square against a uniform distribution was 63.0 on 59 degrees of freedom, where roughly 79 would be needed for significance at the 5% level. There is no clustering, so there is nothing to publish. It is noted rather than dropped silently because a measurement that found nothing is still a measurement, and the next person to have the idea should be able to see that it was tried.

- 2026-09-09 — no figure and no definition moved; this entry records a change to `CONSTRAINTS.md`, which clause 9 of that file binds to the same rule as a definition. Clause 1 was split: scoring, predicting and recommending an individual token stay banned, and ranking by a measured quantity became permitted provided the quantity is shown on the page it orders. A list ordered by buys, curve fill or age is an ordering of facts; "most promising" would still be a verdict. Clause 8 was relaxed to permit an optional email field, no wallet or account still required to read anything. Clause 10 was rewritten from a general instruction into the concrete rule pons's own documentation asks for: write the name in lowercase, link back to the app, carry a non-affiliation line. Clause 11 is new — a figure sourced from a third-party API rather than derived from chain data is exempt from the recompute check below and must say on the page where it came from, because an unlabelled external figure is the same defect as a missing denominator. The copy list narrowed to claims that cannot be supported. None of this changes how any published number is computed, and the recompute check still covers every chain-derived figure byte for byte.

- 2026-09-08 — one new published figure, no existing definition changed: the share of launches that never took a single buy. It is published as a dated sample rather than a live rate, because it is not derived from the launch and graduation files the recompute check regenerates. 187 of 200 matured launches, 93.5%, with the quote reserve read live from each launch's own bonding curve on 8 September 2026. It carries its own n and its own date wherever it appears, and it does not move when the hourly crawl runs. Refreshing it means a new sample under a new date, never an edit to this one.

- 2026-09-07 — every cohort row now carries its own excluding-fast rate alongside its raw rate, and the pair-token finding on the front page is stated on the excluding-fast rate. Reason: the raw rates read ETH 1.64%, tokenized stock 2.37%, stablecoin 3.17% over the indexed record, and 0.71% / 0.71% / 0.73% once graduations inside the 300-second cutoff are removed. The apparent pair-token difference is entirely graduations that completed inside the cutoff. The page had stated the raw comparison, which invited a between-bucket reading of the number the same page calls contaminated. No definition changed; `cohorts.*` rows gained an `excludingFast` block of the shape `cohorts.pairTax` rows already carried.
- 2026-09-07 — **`crawledAt` is now defined as the block timestamp of the last indexed block**, not the wall-clock time of the run that wrote the file. Both are published: `state.json` gains `lastIndexedAt` (the block header time, written by the crawl from the header of `lastIndexedBlock`), and `lastRunAt`/`lastSuccessAt` keep their wall-clock meaning for the `stale` flag alone. A backwards backfill, which does not advance the cursor, no longer moves `crawledAt`. Why it changed: the 24-hour backfill run stamped `crawledAt` with its own clock while `lastIndexedBlock` stayed at the older forward cursor, so the trailing window `[crawledAt − 86400, crawledAt)` ended about 81 minutes past the last block indexed. Those 81 minutes were never scanned and so held no launches, and the window's denominator was short by them. The 24-hour figures moved when the definition was fixed: 26,265 launches and 533 graduations became 28,525 and 598, the raw rate 2.03% became 2.10%, and the rate excluding graduations inside 5 minutes moved from 1 in 138 to 1 in 135. `number.json`'s schema is unchanged — `crawledAt` is still a string — and no other definition moved. Age is still the consumer's computation from `crawledAt`, which now measures the age of the chain data rather than the age of the run.

- 2026-09-07 — the weekly dispatch's window is min(7 days, the indexed record). It read the trailing 7 days regardless of how much record existed and labelled the result "last 7 days", so a 29-hour record was published under a 7-day heading. The window is now clamped to the record and every label in the message — subject, heading, the rate line, the cohort lines — names the span actually measured ("the indexed record so far: 29 h to 6 Sep 2026"). No figure on the site is affected: the dispatch's window has never been in `number.json`.

- 2026-09-06 — two new published figures, no existing definition changed. (1) The time-to-graduation ladder: cumulative counts and shares at eleven fixed second marks (30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600), counted strictly below each mark. The marks were chosen to be dense where the observed distribution is dense — 44% of graduations land inside 60 s — and to reach past the slowest graduation recorded in the 20-hour backfill (about 5 hours). Moving a mark is a change to a published figure and needs its own entry here. (2) The pair-token x creator-tax cell grid, 20 cells, published with every cell's n whether or not a rate can be printed. Both are computed by the same stats engine as every other figure and covered by the same byte-for-byte recompute check. The two rates already published (raw and excluding fast) are unchanged, and no number already on the site moved.

- 2026-09-06 — the fold now leads with the excluding-fast figure, shown as "1 in N" with its rate beside it; the raw rate is the second figure. Both rates are always shown together with the same denominator; only the order changed. Reason: the raw rate is indistinguishable from figures published for other launchpads, while the rate excluding graduations inside 5 minutes is the measurement this site exists to publish. No definition changed.
- 2026-09-06 — window convention stated explicitly as half-open `[since, until)`; previously the text said "within the trailing 24 hours" and the code selected the closed interval `[since, until]`, which counted a launch landing exactly on a window boundary in both adjacent windows. No published figure changed at the sample sizes recorded so far. `number.json` `schemaVersion` raised to 2 in the same change: `fastShares.under300Share`, `fastShares.under60Share`, `deployers.launched2plusShare` and `deployers.from10plusShare` are now `null` with an `insufficient` flag below n = 30 instead of `0.0`, and `stale` now reports only that the generating run knew it was behind (age is computed by the consumer from `crawledAt`).
- 2026-09-06 — initial definitions. 20-hour backfill (23,552 launches, 535 graduations) used to set the fast-graduation threshold and the cohort bucket edges. Superseded finding recorded: the first 3.4-hour sample suggested no graduations after ~90 minutes; the 20-hour data shows 32 graduations after 90 minutes (max ≈ 5 hours). No boundary claim is made.
