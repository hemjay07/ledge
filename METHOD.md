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
- **The Pons Number (24h)**: graduations of launches whose launch timestamp falls within the trailing 24 hours, divided by launches in that window. Because a launch near the end of the window may still graduate, the number is a lower bound for the most recent hours; the page says so.
- **Excluding fast graduations (24h)**: same denominator; numerator excludes fast graduations. Shown beside the Pons Number, never instead of it. Also displayed as "1 in N" where N = round(1 / rate).
- **All-time**: same two rates over every launch since the first block LEDGE indexed (block recorded on `/method`).

## Cohorts (all with n; n < 30 renders as "not enough data")

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
- If `crawledAt` is older than 2 hours at render time, the page shows a stale banner; `/number.json` carries `stale: true`.

## Reproducibility

- Raw data: `data/launches/YYYY-MM-DD.jsonl` (one line per launch: token, curve, deployer, pairToken, pairClass, creatorTaxBps, block, ts) and `data/graduations/YYYY-MM-DD.jsonl` (token, block, ts, pairTokenAmount).
- Computed: `data/number.json` — every figure on the site, with its n and window.
- `scripts/recompute.py` regenerates `number.json` from the raw files with no network access. CI runs it and diffs against the committed file; a mismatch fails the deploy.
- Anyone can run the same script against the same files and get the same numbers.

## Changelog of definitions

- 2026-09-06 — initial definitions. 20-hour backfill (23,552 launches, 535 graduations) used to set the fast-graduation threshold and the cohort bucket edges. Superseded finding recorded: the first 3.4-hour sample suggested no graduations after ~90 minutes; the 20-hour data shows 32 graduations after 90 minutes (max ≈ 5 hours). No boundary claim is made.
