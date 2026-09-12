# Outcomes, step 5: the backfill probe. 2026-09-12.

Repo `/Users/mujeeb/ledge`. Read `OUTCOMES.md` in full — especially
"What a backfill costs", which is the measurement this design rests on —
then `CONSTRAINTS.md`, `pipeline/pool.py`, `pipeline/crawl.py`'s pool
section (step 2), `pipeline/stats.py`'s `outcomes` block (step 3),
`pipeline/rpc.py`, and `METHOD.md`'s outcomes entry.

## Why a probe and not a replay

Measured: twenty pons pools produced 19,811 swaps in 50,000 blocks, so
replaying the whole record is tens of millions of logs — impossible on a
public endpoint. But the statistics need one thing per pool per mark: the
**last swap at or before it**. One pool over 500 blocks is 39 logs and one
second, and `eth_getLogs` batches five to a JSON-RPC request. About 2,000
pools times three marks is ~6,000 probes: two to three hours, once.

## Build — `pipeline/backfill_pools.py` (new)

A standalone script, not part of the hourly crawl. It must be **resumable**
(killable at any point, restartable without redoing work) and must **never
touch** `data/launches`, `data/graduations`, `data/state.json`,
`data/number.json` or `data/pools/YYYY-MM-DD.jsonl` — the forward crawl owns
those.

1. **Find the pools.** Scan `Initialize` on the PoolManager across the whole
   indexed range (`state.json`'s `firstIndexedBlock` to `lastIndexedBlock`)
   in the same 1,000-block windows and pacing the crawl uses, keeping only
   pons-hooked pools, and append them to the existing
   `data/pools/index.jsonl` under its existing dedupe by `(txHash,
   logIndex)`. This is the one part that is a full scan; it is one request
   per window and no filter is possible (`hooks` is not indexed). Resume
   from the highest block already in the index.

2. **Probe the marks.** For every pool in the index whose token has a
   graduation on record, and for each mark in +1 h, +24 h, +7 d measured
   from **that pool's own `Initialize` block time**:
   - Skip the mark entirely if it has not elapsed by the record's own
     `lastIndexedAt` — an unelapsed mark is not `noTrade` and must not be
     written at all.
   - Query `Swap` filtered to that one pool id over a window **ending at
     the mark's block**, widening only if empty: 500 blocks, then 3,000,
     then 15,000. Take the **last** swap in the window and price it with
     `quote_per_token`.
   - If all three widths are empty, write the point with `price: null` and
     `noTrade: true`. Both are readings, not gaps.
   - Batch five probes to a JSON-RPC request. Honour the crawl's retry and
     pacing conventions; a busy endpoint is retried, never counted as
     silence.

3. **Write `data/pools/backfill.jsonl`** — its own file, never mixed with
   the forward hour bars:
   ```
   {"pool","token","mark":"1h|24h|7d","markBlock","markTs",
    "price": "…"|null, "noTrade": bool, "readAtBlock": …|null,
    "windowBlocks": 500|3000|15000|null, "source":"backfill-probe"}
   ```
   `readAtBlock` and `windowBlocks` are what make the reading checkable:
   anyone can re-run the same probe and get the same number. Append-only,
   deduped on `(pool, mark)`, written with the same `.tmp` + `os.replace`
   discipline the crawl uses so a kill never leaves a half file.

4. **`pipeline/stats.py`** — the `outcomes` block prefers a real hour bar
   and falls back to a backfill point for a mark it has no bar for. A mark
   answered by a probe counts toward `n`, `noTrade` and the medians exactly
   as a bar does — the price is the price — but the block must also publish
   **`fromProbe`**: how many of this cohort-mark's readings came from a
   probe rather than a bar, so a reader can see it. Keep every existing
   rule (unelapsed marks uncounted, `withoutPrice` excluded and counted,
   n < 30 insufficient).

5. **`METHOD.md`** — extend the dated outcomes entry: what a probe is, the
   three widening widths, that a probe carries a price but no swap count or
   volume, that `readAtBlock`/`windowBlocks` make it reproducible, and the
   one risk it carries — a pool that traded just outside the widest window
   reads as `noTrade`. State the risk plainly rather than hiding it.

6. **`site/lib/schema.ts`** — mirror `fromProbe` as optional. No page
   changes.

## Tests — `pipeline/tests/test_backfill_pools.py` (new)
Offline, fake transports:
- a mark not yet elapsed is not written at all;
- an empty 500-block window widens to 3,000 then 15,000, and only then
  writes `noTrade`;
- the **last** swap in the window is taken, not the first;
- a rerun re-probes nothing already in `backfill.jsonl` (resumability);
- a busy endpoint retries and never writes `noTrade`;
- `stats.py` counts a probe reading in `n` and reports it in `fromProbe`;
- a real hour bar wins over a probe for the same mark.

`.venv/bin/pytest pipeline/tests -q` green, `python pipeline/recompute.py
--check` exit 0, `cd site && npm test` green, `bash scripts/lint-copy.sh`
clean.

## Do not run it against the chain in this task
Build and test it only. I will run it myself, in chunks, and check what it
produces before anything is committed to `data/`.

## Report
✅ DONE / 📋 PLANNED. The exact command to run it, including how to resume
and how to limit it to N pools for a first trial. Do not commit. Do not
touch `worker/`, `site/app`, or `data/` by hand.
