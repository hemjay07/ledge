# What happens after a graduation

Written 2026-09-12. Status: **steps 1 and 2 built and proven against the
chain; steps 3 to 5 not started.**

## The question it answers

Today the site says "graduated in 8 s" and stops. The question a trader has
at that moment is *does this kind hold, or dump?* This tracker answers it as
a cohort fact, which is the only form the constraints allow and the only
form that is honest:

> Tokens that graduated in under 10 s: median change at +24 h −78%
> (n=412). Over 5 min: −31% (n=1,140).

No verdict on any token (CONSTRAINTS 1). Every figure with n and window
(3). Not printed below n=30 (4). Which cohort leads is a choice; none is
hidden (5). The 5-minute mark stays descriptive (6).

It is also the one dataset that cannot be collected later: a price at
+1 h after a graduation exists at that hour and not afterwards, except by
replaying every swap — which nobody on this chain has done, and which gets
more expensive every day.

## What is on the chain — measured 2026-09-12

- pons graduates into **Uniswap v4** on a single `PoolManager` at
  `0x8366a39cc670b4001a1121b8f6a443a643e40951`, with pons's hook at
  `0xe5e702641ea86f4ae6cc3cdaed2b886f976be044` (both read off the factory:
  `poolManager()`, `memeHook()`).
- `Initialize(id, currency0, currency1, fee, tickSpacing, hooks,
  sqrtPriceX96, tick)` fires once per pool: it maps the pool id to the token
  and the pair, says whether the hook is pons's, and carries the **opening
  price**.
- `Swap(id, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee)`
  fires per trade with the price after the trade. **About 100,000 an hour**
  across the whole PoolManager (8,647 in a 3,000-block sample; 30 pools
  initialised in the same span). Too many to keep raw; enough to read.

So: prices come from logs, never from state. That means no archive node,
no "read the pool at a past block", and every figure is reproducible by
anyone who replays the same logs — which is the standard every number on
this site already meets.

## What is stored

**`data/pools/YYYY-MM-DD.jsonl`** — one line per (pons pool, hour):

```
{"pool": "0x…id", "token": "0x…", "hour": "2026-09-12T14", "open": …,
 "close": …, "high": …, "low": …, "swaps": 41, "volumeQuote": "…wei"}
```

Prices as the quote-per-token ratio derived from `sqrtPriceX96`, with the
token/pair orientation fixed from `Initialize`'s `currency0/currency1`.
Only pools whose `hooks` is pons's hook are kept; the other ~95% of swaps
are read and dropped. Ten thousand lines a day at most, appended and
rotated like the launch partitions.

**`data/pools/index.jsonl`** — one line per pons pool from `Initialize`:
pool id, token, pair, block, opening `sqrtPriceX96`. Joined to
`graduations` by token.

Both are raw observations (Class B) and go through the same all-or-nothing
commit `crawl.py` already guarantees.

## What is computed — in `pipeline/stats.py`, behind the recompute gate

For each graduation with a pool and enough elapsed time:

- `priceAt(+1h)`, `priceAt(+24h)`, `priceAt(+7d)`: the close of the last
  hour bar at or before the mark. **No bar at or before the mark = no
  trade since graduation = its own outcome**, recorded as `noTrade`, never
  as a price of 0 and never dropped.
- `changeAt(mark) = priceAt(mark) / openingPrice − 1`.
- `volumeQuote(+24h)`, `swaps(+24h)`.

Cohorts, each with n, over the same windows the site already publishes:

- by time-to-graduation bucket (the existing histogram edges: under 10 s,
  10 s–5 min, over 5 min — the descriptive marks already on `/graduated`),
- by pair token, by creator tax band (the existing cohorts),

reporting for each mark: n, share `noTrade`, median change, p25, p75.
Medians and quartiles, not means: a single 50× token would otherwise
carry a cohort. Below n=30: "not enough data (n=…)". A mark that has not
elapsed for a graduation is simply not counted toward that mark's n.

New statistics, so **`METHOD.md` gets a dated entry** before any of it is
published (CONSTRAINTS 9), and the vector gate covers the per-token
sentences.

## Where it shows

- **`/t/{address}`** — the cohort card already reserves the slot: "Tokens
  that graduated in {bucket}: median +24 h change {x}% (n=…); {y}% had no
  trade at all." And, for a graduated token, its own facts: opening price,
  +1 h, +24 h, +7 d, swaps, volume — its own numbers, no comparison drawn.
- **`/graduated`** — one more column on the ladder, or a second small
  table under it: change at +24 h by bucket.
- **The homepage** — the single strongest line it produces, once n clears
  30 for at least two buckets, replaces or joins the callout.
- **The bot** — "graduated in 8 s · +24 h: −81% · 3 swaps" when the mark
  passes, as a reading, never as advice.

## Cost and where it runs

Reading 100,000 logs an hour is a steady background job, not a GitHub
Actions job: it is the second reason the crawl moves to the box
(`INDEXER.md`). Same RPC, same 1,000-block windows, one process. Storage
is a few MB a day in the repo's data partitions, rotated to `.gz`.

## What has been proven, and how

**Step 1 (decoders and pricing), 2026-09-12.** `pipeline/pool.py`. The
layouts were verified against real logs from the deployed PoolManager, not
derived from the signature: `Initialize` carries `id`, `currency0` and
`currency1` as INDEXED topics, and a first pass that read all seven fields
out of `data` crashed on every real log. Two real logs are pasted into
`pipeline/tests/test_pool.py` as fixtures for that reason.

**Step 2 (collection), 2026-09-12.** `pipeline/crawl.py` reads both topics
off the PoolManager in its existing window loop and writes
`data/pools/index.jsonl` and `data/pools/YYYY-MM-DD.jsonl` inside the same
all-or-nothing commit as every other partition.

Measured while building it:

- **Swap reads are filtered server-side by pool id.** The endpoint accepts
  an array of pool ids in the second topic position as an OR match: one
  request returned the same 239 logs as five single-id requests over the
  same window, key for key. So the cost is **two extra requests per
  1,000-block window** whatever the number of pools, not one per pool, and
  the ~100,000 swaps an hour across the whole PoolManager never have to be
  read.
- **`Initialize` cannot be filtered by hook** — `hooks` is not an indexed
  topic — so every pool creation is read and filtered in memory. Measured
  over blocks 61,010,000 to 61,046,000 (about an hour): 736 pools created,
  of which **6 carry pons's hook**. Reading 736 to keep 6 is the price, and
  it is small.
- **A real run wrote real bars.** Crawling blocks 61,034,001 to 61,047,488
  against the chain produced two pons pools and their hour bars; the
  ETH-paired one opened at 2.06e-8 ETH per token and closed the same hour at
  1.22e-8, a 41% fall inside sixty minutes. The other pool's pair token has
  no decimals on record, so its prices are `null` and its swap count and
  quote volume are kept — never a guessed price.

**Known gap, written down rather than hidden.** Launches, graduations and
the pool index are reorg-safe by key dedupe. Hour bars are aggregates with
no per-swap key on disk, so a swap is folded only when its block is above
the run's starting cursor; the ~3,000-block reorg window is therefore not
re-folded, and a reorg inside it would leave a bar slightly wrong rather
than double-counted. About five minutes of chain, and the alternative
(keeping every swap key) costs more than the error.

## Order of work

1. `pipeline/rpc.py`: decode `Initialize` and `Swap`; price from
   `sqrtPriceX96` with orientation — with tests against hand-computed
   fixtures, including both token orderings.
2. `crawl.py`: read the two topics on the PoolManager per window; keep
   pons pools; fold swaps into hour bars in memory; write the two
   partitions under the existing commit guarantee.
3. `stats.py`: `outcomes` block; vectors; `METHOD.md` entry.
4. Surfaces, in the order above, each screenshotted.
5. **Backfill**: replay from the first indexed graduation (2026-09-05).
   Logs are permanent, so the history is recoverable once — and that is
   exactly the work a copycat would have to redo. Do it before anything is
   published so the first figures carry a real n.

Nothing publishes until `METHOD.md` has the entry and the recompute gate
passes. DONE means the +24 h figure with n ≥ 30 in at least two
time-to-graduation buckets, on `/t/{address}` and `/graduated`, with the
method written down.
