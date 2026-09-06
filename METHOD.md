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
- **All-time**: same two rates over every launch since the first block LEDGE indexed (block recorded on `/method`).

## Precision

Rates are printed to the precision the sample supports: two decimals at n ≥ 1,000, one decimal below, and "not enough data (n=…)" under 30. A bucket that recorded no graduations prints the count it observed ("0 of 244") rather than "0.0%", which would read as a measured finding rather than an absent one.

## Cohorts (all with n; n < 30 renders as "not enough data")

The n < 30 rule applies to **every** published proportion, not only cohort rates: the share of graduations under 300 s and under 60 s, and both deployer shares. Below 30 the share is `null` with `insufficient: true` — never `0.0`, which would read as a measured finding rather than an absent one.

- **Pair token**: three buckets — ETH (`pairToken == 0x0`), stablecoin, tokenized stock/other. Bucket assignment uses the pair token contract's `symbol()`; the mapping table is public in the repo and any unknown symbol lands in "other" until classified.
- **Creator tax**: 0%, 1%, 2–3%, 4–5%, 6–10% (`creatorTaxBps` from `getLaunchedToken`).
- **Hour of day (UTC)**: 24 buckets by launch timestamp.
- **Day of week (UTC)**: 7 buckets; renders "not enough data" until every bucket has n ≥ 30.
- **Deployers (aggregate only)**: distinct deployers in window; share that launched 2+; share of launches from deployers with 10+; distribution of launches-per-deployer as a histogram. No addresses.

## Time-to-graduation distribution

Percentiles p10 / p25 / p50 / p75 / p90 / p95 / max of time to graduation, over the same window as the rate shown. Rendered as a horizontal bar with those ticks. Copy: "9 in 10 graduations happened within {p90}". No boundary claims ("nothing after X") are made.

## Freshness

- The crawler runs hourly. Each run records `crawledAt` and `headBlock`.
- Every rendered figure shows "updated {age} ago" computed from `crawledAt`.
- **Age is the consumer's computation, not a field.** `number.json` is a static file and cannot age its own contents. Any consumer — the page, the card, a third party reading `/number.json` — computes `now − crawledAt` and compares it to the published `staleAfterSeconds` (7200). If `crawledAt` is older than that at render time, the page shows the stale banner.
- **`stale` in the file means one thing: the run that generated the file knew it was already behind** — it recorded a failure since its last success (`consecutiveFailures > 0`, or `lastRunAt` after `lastSuccessAt`, or no successful run yet). A successful run publishes `stale: false` however old the data later becomes. A failed run commits nothing at all, so `crawledAt` simply ages and the banner appears from the age computation above.

## Reproducibility

- Raw data: `data/launches/YYYY-MM-DD.jsonl` (one line per launch: token, curve, deployer, pairToken, pairClass, creatorTaxBps, block, ts) and `data/graduations/YYYY-MM-DD.jsonl` (token, block, ts, pairTokenAmount).
- Computed: `data/number.json` — every figure on the site, with its n and window.
- `scripts/recompute.py` regenerates `number.json` from the raw files with no network access. CI runs it and diffs against the committed file; a mismatch fails the deploy.
- Anyone can run the same script against the same files and get the same numbers.

## Changelog of definitions

- 2026-09-06 — the fold now leads with the excluding-fast figure, shown as "1 in N" with its rate beside it; the raw rate is the second figure. Both rates are always shown together with the same denominator; only the order changed. Reason: the raw rate is indistinguishable from figures published for other launchpads, while the rate excluding graduations inside 5 minutes is the measurement this site exists to publish. No definition changed.
- 2026-09-06 — window convention stated explicitly as half-open `[since, until)`; previously the text said "within the trailing 24 hours" and the code selected the closed interval `[since, until]`, which counted a launch landing exactly on a window boundary in both adjacent windows. No published figure changed at the sample sizes recorded so far. `number.json` `schemaVersion` raised to 2 in the same change: `fastShares.under300Share`, `fastShares.under60Share`, `deployers.launched2plusShare` and `deployers.from10plusShare` are now `null` with an `insufficient` flag below n = 30 instead of `0.0`, and `stale` now reports only that the generating run knew it was behind (age is computed by the consumer from `crawledAt`).
- 2026-09-06 — initial definitions. 20-hour backfill (23,552 launches, 535 graduations) used to set the fast-graduation threshold and the cohort bucket edges. Superseded finding recorded: the first 3.4-hour sample suggested no graduations after ~90 minutes; the 20-hour data shows 32 graduations after 90 minutes (max ≈ 5 hours). No boundary claim is made.
