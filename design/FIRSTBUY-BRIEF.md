# First-buy timing — implementation brief (A5b), 2026-09-13

Read `CONSTRAINTS.md`, `METHOD.md` ("Freshness", the changelog format),
`ARCHITECTURE.md` (partitions, the commit point), `pipeline/crawl.py`,
`pipeline/stats.py` (`cohort`, `_window_block`, `outcomes`),
`pipeline/recompute.py`, and `pipeline/tests/test_pools_crawl.py` (the
stub RPC and the pinning test) before writing anything.

## What was measured today, from the box, on the official endpoint

Live windows, 2026-09-13 ~18:00Z, not yet a published figure:

- 1,000 blocks (~100 s of chain): 819 `CurveBuy` logs, 35 launches.
- 6,000 blocks: 207 launches; 183 had a buy in range; **158 of those first
  buys were in the launch transaction itself** (same `transactionHash` as
  `TokenLaunched`); the buyer topic equalled the deployer in 3. So the
  launch tx carries the launch's own initial buy, routed through something
  other than the deployer's address.
- Of 149 launches with a buy **outside** the launch tx, 80 had it within
  0–9 blocks (≈ under a second), 26 within 10–19 blocks.
- 3,000 blocks, ~50 min later: 107 launches; 89 had a launch-tx buy, median
  quoteIn 0.035 (pair-token units, 18 decimals), max 11.9; 92 had a sell
  within ~50 min; 75 had an outside buy and 73 of those were sold into.

So "first buy" has two different meanings and the record must keep them
apart: the **launch-tx buy** (the launch's own opening buy) and the **first
outside buy** (the first `CurveBuy` on that curve from any other
transaction). Sniping is a statement about the second.

## Definition (goes into METHOD.md as a dated entry, written by you)

For every launch whose block is ≥ `state.firstBuyIndexedFromBlock` (the
cursor the first run with this code started from — set it once, never
move it), the crawl records:

1. **launch-tx buy**: whether the launch transaction emitted a `CurveBuy`
   from the launch's curve, and that buy's `quoteIn` and `tax` (decimal
   strings). One record, `inLaunchTx: true`.
2. **first outside buy**: the earliest `CurveBuy` emitted by the launch's
   curve whose `transactionHash` differs from the launch's, ordered by
   (block, logIndex). One record, `inLaunchTx: false`, with its block,
   block timestamp, `quoteIn`, `tax`, and `buyerIsDeployer` (bool). **The
   buyer address is never written** (CONSTRAINTS 2).

Launches before `firstBuyIndexedFromBlock` have no record and are outside
the population; their earlier buys were never read, so a "first" for them
would be false.

Timing is `ts(buy block) − ts(launch block)` in whole seconds from block
headers, never from block numbers (METHOD.md forbids the conversion).
"Same block" is a block fact and is its own bucket.

## Record

`data/firstbuys/YYYY-MM-DD.jsonl(.gz)`, partitioned by the **buy's** block
timestamp like every other partition, deduped on the buy's
`(txHash, logIndex)`, rotated by the existing `plan_partition_writes`:

```
{"token","curve","launchBlock","launchTs","launchTxHash",
 "inLaunchTx":bool,"block","ts","txHash","logIndex",
 "quoteIn":str,"tax":str,"buyerIsDeployer":bool}
```

`CurveBuy(address,address,uint256,uint256,uint256,uint256)`, topic0
`0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455`,
topics[1]=buyer, topics[2]=recipient, data words [0]=quoteIn [1]=tokensOut
[2]=fee [3]=tax; emitted by the launch's own curve, so it is read by topic0
with **no address filter** and the curve is the log's `address`
(`worker/src/pons.ts` has the verified layout). A real log for the test
fixture:

```
address 0xfff76406e7eb1878a803e10dc3ce6aafc3093ecd
topics  [0xec36bf57…c455, 0x…f447c6f0d1fc3b2896336bee2e3123f01b9303de, 0x…f447c6f0d1fc3b2896336bee2e3123f01b9303de]
data    0x000000000000000000000000000000000000000000000000000168b3fafd6cdf
        0000000000000000000000000000000000000000000006ee7245d73dadf96b56
        0000000000000000000000000000000000000000000000000000039b66599302
        00000000000000000000000000000000000000000000000000000ad2330cb906
blockNumber 0x3b492ac  txHash 0xc7c218a5c16734b4be64916347dc25b11ac4218316ffd730fc4b60b971e695aa  logIndex 0x3b
block timestamp 1789323715
```

## Crawl (pipeline/crawl.py)

- `rpc.get_logs` must accept `address=None` and then omit the key from the
  filter. Default stays the factory.
- Per window, after the three existing reads: `get_logs(frm, to,
  TOPIC_CURVE_BUY, address=None)`. ~820 logs per 1,000 blocks; 0.3 s on the
  official endpoint.
- The **open set**: every launch with block ≥ `firstBuyIndexedFromBlock`
  and no `inLaunchTx: false` record yet, keyed by curve → launch (from the
  existing partitions plus this run's new launches, in block order). Buys
  are processed in (block, logIndex) order; a buy whose curve is not in the
  open set is dropped; the first outside buy closes the launch. A buy whose
  txHash equals the launch's txHash is the launch-tx buy (recorded once).
- Only the recorded buys' blocks need timestamps (≤ ~2 per launch), so the
  header cost is one batch per window at most. Add them to the existing
  `_fetch_block_timestamps` call.
- Dedupe and the reorg re-scan work exactly as for launches: a buy already
  in a partition is dropped by `(txHash, logIndex)`; the open set is built
  from the record, so a re-seen buy never creates a second "first".
- `state.firstBuyIndexedFromBlock`: set on the first run that finds it
  absent, to that run's `start_block`. Present in `state.json` thereafter.
- Everything stays in memory until the commit point, like every other
  output. `_pools_after_write` shows the pattern for handing recompute's
  view to `build_number`; for firstbuys pass the merged list the same way
  recompute will load it.

## Statistics (pipeline/stats.py, Class A — nowhere else)

`number.json` gains a top-level optional block `firstBuy`:

```
"firstBuy": {
  "indexedFromBlock": int|null,
  "population": "launches at least one hour old at crawledAt, launched at or after indexedFromBlock",
  "cohorts": {
    "all":       [row],
    "taxBucket": [row per TAX_BUCKETS],
    "pairClass": [row per PAIR_BUCKETS]
  }
}
row = {"bucket", "n",
       "launchTxBuy": count, "launchTxBuyShare": rate|null,
       "outside": {"sameBlock","within1s","within3s","within5s","after5s","none"}  (counts, exclusive buckets, sum = n),
       "sameBlockShare","within1sShare","within3sShare","within5sShare" (CUMULATIVE rates|null),
       "noneShare": rate|null,
       "insufficient": n < 30}
```

- Population: launches with `ts ≤ until − 3600` and block ≥
  `indexedFromBlock`, over the whole record (no h24 split — keep it one
  block; the window is stated in `population`).
- Buckets by `delta = buy.ts − launch.ts`: `sameBlock` (buy.block ==
  launch.block); else `within1s` (delta ≤ 1); `within3s` (1 < delta ≤ 3);
  `within5s` (3 < delta ≤ 5); `after5s`; `none` (no outside record).
- Cumulative shares include the buckets before them (`within5sShare` =
  (sameBlock+within1s+within3s+within5s)/n). n < 30 → shares `null`,
  `insufficient: true`, counts still published (CONSTRAINTS 4, 5).
- `recompute.py` gains `load_firstbuys(data_dir)` and passes
  `firstbuys=` to `build_number`; the crawl passes the same list.
- The 5-second edge: `HISTOGRAM_EDGES` already has 5. `LADDER_EDGES`
  starts at 30 — leave it; the histogram is where the edge is read.

## Tests (write them red first; show the red run in your report)

- `test_rpc.py`: `get_logs(..., address=None)` sends no `address` key.
- `test_firstbuy_crawl.py` (new): with the stub RPC from
  `test_pools_crawl.py` extended to serve `TOPIC_CURVE_BUY`:
  1. a launch, a buy in the launch tx, and a later buy → two records,
     `inLaunchTx` true/false, `buyerIsDeployer` false, no buyer address in
     the file (assert the buyer's hex is absent from the partition text);
  2. a second run re-seeing the same buys → no duplicate records;
  3. a launch from before `firstBuyIndexedFromBlock` → no record;
  4. the real log above decodes to the expected fields;
  5. crawl.run then `recompute.recompute` agree byte for byte with
     firstbuys present (the pinning pattern in `test_pools_crawl.py`).
- `test_stats.py` additions: bucket edges (delta 1 → within1s, 3 →
  within3s, 5 → within5s, 6 → after5s; same block beats delta), cumulative
  shares, n < 30 → nulls with counts, population excludes launches under
  an hour old and launches before `indexedFromBlock`.
- Run `python pipeline/vectors.py` and commit the regenerated
  `tests/vectors/*` (they are generated; that is expected).
- `.venv/bin/pytest pipeline/tests -q`, `python pipeline/recompute.py
  --check`, `scripts/lint-worker.sh`, `scripts/lint-copy.sh` all clean.

## METHOD.md

One dated entry, 2026-09-13, in the existing changelog style: the two
definitions, the population, the buckets, why the launch-tx buy is kept
apart (the measurement above), `firstBuyIndexedFromBlock` and why launches
before it are outside the population, and that no wallet is recorded.

## Out of scope for this brief

The `/cohorts` and `/t/{address}` surfaces (site + Worker), and the
backfill of first buys to 14 August. Do not touch `site/` or `worker/`
beyond adding the optional `firstBuy` field to `site/lib/schema.ts` and
`worker/src/schema.ts` / `site/lib/api-schema.ts` if the vector test
requires it.
