# Outcomes, step 2: the crawl collects pool prices. 2026-09-12.

Repo `/Users/mujeeb/ledge`. Read `OUTCOMES.md` (the design; this is its
step 2), `CONSTRAINTS.md`, `pipeline/pool.py` (step 1, already merged — the
decoders and `quote_per_token`, verified against real chain logs),
`pipeline/crawl.py` **in full** (especially the module docstring's commit
guarantee and the three ordering consequences), `pipeline/rpc.py`
(`get_logs` currently hard-codes `address: FACTORY_ADDRESS`), and
`pipeline/tests/test_crawl.py` for the house test style.

## What this step does, and nothing more

Collect what happens to a token **after** it graduates, into two new data
partitions, inside the crawl's existing all-or-nothing commit. No
statistics, no site changes, no `stats.py`, no `METHOD.md` — those are
step 3.

## Build

1. **`pipeline/rpc.py`**: `get_logs` must take an optional address so the
   same client can read the PoolManager as well as the factory. Default
   stays `FACTORY_ADDRESS`; every existing caller is unchanged. Keep the
   per-item error handling exactly as it is.

2. **`data/pools/index.jsonl`** — one line per pons pool, appended as
   `Initialize` logs are seen: `{pool, token, pair, block, ts,
   sqrtPriceX96, tickSpacing, txHash, logIndex}`. `token` is whichever of
   `currency0`/`currency1` is not the pair token; decide it by looking the
   pool's currencies up against the launches the record already holds (a
   pons pool's non-pair side is a token LEDGE has indexed). If neither side
   matches a known launch, write the line with `token: null` rather than
   guessing — it is still a pons pool and the record should say so.
   Only pools whose `hooks` is pons's hook are kept (`is_pons_pool`).

3. **`data/pools/YYYY-MM-DD.jsonl`** — one line per (pool, hour):
   `{pool, token, hour, open, close, high, low, swaps, volumeQuote}`.
   Prices are `quote_per_token` at each swap's own `sqrtPriceX96`, using the
   decimals the record already knows (`data/pair-tokens.json` for the pair
   side, 18 for a launched token unless something says otherwise — if the
   token's decimals are not known, write `open/close/high/low: null` and
   keep `swaps` and `volumeQuote`, never a guessed price).
   `volumeQuote` is the sum of the absolute quote-side amounts, as a decimal
   string. An hour bar already on disk for the same (pool, hour) is merged
   with this run's, not replaced: `open` is the earliest, `close` the
   latest, `high`/`low` the extremes, `swaps` and `volumeQuote` add up.
   Hours are UTC and come from the block timestamp, never the wall clock.

4. **`crawl.py`**: in the same window loop, read the two new topics off the
   PoolManager. Follow the existing pacing (`LOG_PACING_SECONDS` between
   calls). **Swap volume is ~100,000 logs an hour across the whole
   PoolManager**, so a naive read of every Swap is far more data than the
   crawl can carry: read `Initialize` for the whole window, but read `Swap`
   **filtered to the pons pool ids the record knows** — `eth_getLogs`
   accepts a second topic filter (`topics: [SWAP, poolId]`), and pool ids
   can be batched by issuing one request per pool id or by using an array
   of ids in the second position if the endpoint accepts it. **Measure
   which the endpoint supports before choosing**, and say in the report
   what you measured. If neither is viable within the crawl's time budget,
   stop and report rather than reading 100k logs a window.

5. The two new payloads join the commit in the existing order and by the
   existing mechanism: computed in memory, written to `.tmp`, `os.replace`d
   into place, before `state.json` moves. A failure anywhere leaves the
   data directory byte-for-byte unchanged. Rotation to `.gz` follows the
   same rule as the other partitions.

6. **`pipeline/recompute.py`**: it must keep passing `--check` untouched.
   The pool partitions are inputs to a later step, not to `number.json`;
   if `recompute.py` enumerates `data/` directories, make sure adding
   `data/pools/` does not change a single byte of `number.json`. Prove it:
   run `python pipeline/recompute.py --check` and say so.

## Tests (`pipeline/tests/test_pools_crawl.py`, new)
Offline, with fake transports in the style of `test_crawl.py`:
- an `Initialize` for a pons pool is recorded; one with another hook is not;
- a pool whose non-pair side matches no known launch records `token: null`;
- swaps fold into the right UTC hour bar, open/close/high/low correct, and
  a second run merges into an existing bar rather than replacing it;
- unknown token decimals give null prices but keep `swaps`/`volumeQuote`;
- a failure mid-run leaves `data/` unchanged (the commit guarantee), using
  the same harness `test_crawl.py` uses for that;
- `get_logs` still defaults to the factory address.

`.venv/bin/pytest pipeline/tests -q` green, `python pipeline/recompute.py
--check` exit 0. Do not commit. Do not touch `site/`, `worker/`, `stats.py`,
`METHOD.md`, or anything in `data/` by hand.

## Report
✅ DONE / 📋 PLANNED. What you measured about the Swap filter and how. The
per-window cost of the new reads (requests and logs) at today's rates.
