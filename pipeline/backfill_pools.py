"""Backfill probe: OUTCOMES-BACKFILL-BRIEF.md / OUTCOMES.md "What a
backfill costs". Standalone, resumable, NOT part of the hourly crawl.

It never touches data/launches, data/graduations, data/state.json,
data/number.json or data/pools/YYYY-MM-DD.jsonl -- the forward crawl
(pipeline/crawl.py) owns those. It only appends to data/pools/index.jsonl
(under the crawl's own dedupe writer, plan_pool_index_write) and writes
its own new file, data/pools/backfill.jsonl.

A full replay of every swap is impossible on a public endpoint (~100,000
Swap logs an hour across the whole PoolManager). The statistics need one
thing per pool per mark: the price of the last swap at or before it, from
a narrow window ending at that mark -- 39 logs and a second at 500 blocks,
widening to 3,000 then 15,000 only if empty. This module is exactly that
probe, run once, in chunks, against the whole indexed record.

Two steps:

1. `find_pools` -- Initialize carries no indexed `hooks` topic, so pons
   pools cannot be filtered server-side; the whole indexed range
   (state.json's firstIndexedBlock..lastIndexedBlock) is scanned in the
   same 1,000-block windows and pacing pipeline/crawl.py uses
   (plan_windows, LOG_PACING_SECONDS), resuming from the highest block
   already in data/pools/index.jsonl. Matches are appended under the
   crawl's own append-and-dedupe writer (plan_pool_index_write), so a
   pool this scan already recorded, or one the forward crawl found
   independently, is never duplicated.

2. `build_probe_plan` / `_resolve_chunk` -- for every indexed pool whose
   token has a graduation on record, and each of the three OUTCOME_MARKS
   (+1h/+24h/+7d) measured from *that pool's own Initialize block time*
   (not the graduation's), skip the mark outright if it has not elapsed
   by state.json's own `lastIndexedAt` -- an unelapsed mark is not
   `noTrade` and is never written. Marks are batched five to a JSON-RPC
   request (call_batch) and probed with a Swap query over a window ending
   at an estimated block for the mark, widening 500 -> 3,000 -> 15,000
   only while still empty; the last swap in the final non-empty window is
   priced with pool.quote_per_token. All three widths empty writes
   `noTrade: true, price: null` at windowBlocks=15000 -- a reading, not a
   gap. A per-item RPC error (missing/None result for that request) is
   retried at the SAME width, never treated as an empty window -- only a
   genuinely empty result array widens.

   The mark's block is estimated from the pool's own (block, ts) anchor
   and pipeline/crawl.py's AVG_BLOCK_SECONDS (the same constant that sizes
   a first backfill there); it is an operational definition, not a chain
   fact, which is exactly why the point records `markBlock`, `readAtBlock`
   and `windowBlocks` -- anyone re-running the same formula over the same
   logs gets the same number, per CONSTRAINTS.md's reproducibility bar,
   whatever the estimate's own precision.

Progress is appended to backfill.jsonl (deduped on (pool, mark), same
.tmp + os.replace discipline as every other partition) after every
five-probe chunk, so a kill mid-run loses at most one in-flight chunk and
a rerun re-probes nothing already on disk.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.crawl import AVG_BLOCK_SECONDS, LOG_PACING_SECONDS, _atomic_write_bytes, plan_pool_index_write, plan_windows
from pipeline.pool import POOL_MANAGER, TOPIC_V4_INITIALIZE, TOPIC_V4_SWAP, decode_initialize, decode_swap, is_pons_pool, quote_per_token
from pipeline.recompute import load_partitions
from pipeline.rpc import BACKOFF_BASE_SECONDS, BACKOFF_CAP_SECONDS, MAX_RETRIES
from pipeline.stats import OUTCOME_MARKS

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
POOLS_DIR = "pools"
CHUNK_SIZE = 5  # probes batched into one JSON-RPC request (OUTCOMES.md measured ~10s for five)
WIDTHS = (500, 3000, 15000)  # widening window widths, blocks


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _load_jsonl(path: Path) -> list:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def _parse_iso(value: str) -> int:
    return int(datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


# --- pricing (mirrors pipeline/crawl.py's _pool_price / _pool_token_is_currency0,
# duplicated rather than imported since this is a standalone script and the
# logic is a handful of pure, already-tested lines) --------------------------
def _token_is_currency0(token: str, pair: str) -> bool:
    return int(token, 16) < int(pair, 16)


def _pair_decimals(address: str, pair_tokens: dict) -> Optional[int]:
    if address == ZERO_ADDRESS:
        return 18
    entry = pair_tokens.get(address)
    return entry.get("decimals") if entry else None


def _token_decimals(address: str, pair_tokens: dict) -> int:
    entry = pair_tokens.get(address)
    if entry and "decimals" in entry:
        return entry["decimals"]
    return 18


def _price_of_swap(decoded_swap: dict, token: str, pair: str, pair_tokens: dict):
    if _token_is_currency0(token, pair):
        currency0, currency1 = token, pair
        decimals0, decimals1 = _token_decimals(token, pair_tokens), _pair_decimals(pair, pair_tokens)
    else:
        currency0, currency1 = pair, token
        decimals0, decimals1 = _pair_decimals(pair, pair_tokens), _token_decimals(token, pair_tokens)
    return quote_per_token(decoded_swap["sqrtPriceX96"], currency0, currency1, token, decimals0, decimals1)


# --- step 1: find pons pools across the whole indexed range -----------------
def _pool_orientation(currency0: str, currency1: str, known_launch_tokens: set) -> tuple:
    c0_is_launch = currency0 in known_launch_tokens
    c1_is_launch = currency1 in known_launch_tokens
    if c0_is_launch and not c1_is_launch:
        return currency0, currency1
    if c1_is_launch and not c0_is_launch:
        return currency1, currency0
    return None, None


def _shape_pool_index_row(decoded: dict, known_launch_tokens: set) -> dict:
    token, pair = _pool_orientation(decoded["currency0"], decoded["currency1"], known_launch_tokens)
    return {
        "pool": decoded["id"],
        "token": token,
        "pair": pair,
        "block": decoded["block"],
        "ts": decoded.get("ts"),
        "sqrtPriceX96": decoded["sqrtPriceX96"],
        "tickSpacing": decoded["tickSpacing"],
        "txHash": decoded["txHash"],
        "logIndex": decoded["logIndex"],
    }


def _fetch_timestamps(rpc_client, blocks: list) -> dict:
    unique_blocks = sorted(set(blocks))
    if not unique_blocks:
        return {}
    requests = [{"method": "eth_getBlockByNumber", "params": [hex(b), False]} for b in unique_blocks]
    results = rpc_client.call_batch(requests)
    timestamps = {}
    for block, result in zip(unique_blocks, results):
        if not result:
            raise RuntimeError(f"backfill: missing block header for block {block}")
        timestamps[block] = int(result["timestamp"], 16)
    return timestamps


def find_pools(data_dir, rpc_client, state: dict) -> list:
    """Scan Initialize on the PoolManager over the whole indexed range,
    resuming from the highest block already in data/pools/index.jsonl.
    Returns new pool-index rows (not yet written); the caller appends them
    under plan_pool_index_write's own dedupe."""
    data_dir = Path(data_dir)
    existing_index = _load_jsonl(data_dir / POOLS_DIR / "index.jsonl")
    existing_keys = {(r["txHash"], r["logIndex"]) for r in existing_index}
    resume_block = max((r["block"] for r in existing_index), default=state["firstIndexedBlock"] - 1) + 1
    to_block = state["lastIndexedBlock"]

    windows = plan_windows(resume_block, to_block)
    if not windows:
        return []
    _log(f"backfill: scanning {len(windows)} windows for pons pools, blocks {resume_block}-{to_block}")

    raw = []
    for i, (frm, to) in enumerate(windows, 1):
        if i % 20 == 0 or i == len(windows):
            _log(f"backfill: [{i}/{len(windows)}] pons pools found={len(raw)}")
        for log in rpc_client.get_logs(frm, to, TOPIC_V4_INITIALIZE, address=POOL_MANAGER):
            decoded = decode_initialize(log)
            if is_pons_pool(decoded) and (decoded["txHash"], decoded["logIndex"]) not in existing_keys:
                raw.append(decoded)
                existing_keys.add((decoded["txHash"], decoded["logIndex"]))
        time.sleep(LOG_PACING_SECONDS)

    if not raw:
        return []
    known_launch_tokens = {l["token"] for l in load_partitions(data_dir / "launches")}
    timestamps = _fetch_timestamps(rpc_client, [d["block"] for d in raw])
    for d in raw:
        d["ts"] = timestamps[d["block"]]
    return [_shape_pool_index_row(d, known_launch_tokens) for d in raw]


# --- step 2: probe plan -------------------------------------------------
def build_probe_plan(data_dir, state: dict) -> list:
    """One entry per (pool, mark) still to probe: elapsed by
    state['lastIndexedAt'], the pool's token has a graduation on record,
    and not already in data/pools/backfill.jsonl. `mark_block` is an
    estimate from the pool's own Initialize (block, ts) and
    AVG_BLOCK_SECONDS -- an operational definition, recorded on the point
    so the reading stays reproducible."""
    data_dir = Path(data_dir)
    pool_index = _load_jsonl(data_dir / POOLS_DIR / "index.jsonl")
    graduated_tokens = {g["token"] for g in load_partitions(data_dir / "graduations")}
    already_probed = {(p["pool"], p["mark"]) for p in _load_jsonl(data_dir / POOLS_DIR / "backfill.jsonl")}
    until_ts = _parse_iso(state["lastIndexedAt"])
    head_block = state["lastIndexedBlock"]

    plan = []
    for pool_record in pool_index:
        token = pool_record.get("token")
        anchor_ts = pool_record.get("ts")
        if token is None or anchor_ts is None or token not in graduated_tokens:
            continue
        for label, seconds in OUTCOME_MARKS.items():
            if (pool_record["pool"], label) in already_probed:
                continue
            mark_ts = anchor_ts + seconds
            if until_ts < mark_ts:
                continue  # not elapsed: never written, not noTrade
            mark_block = min(pool_record["block"] + round(seconds / AVG_BLOCK_SECONDS), head_block)
            plan.append({"pool": pool_record, "label": label, "mark_ts": mark_ts, "mark_block": mark_block})
    return plan


def _limit_to_n_pools(plan: list, limit: int) -> list:
    """Cuts the plan off after `limit` distinct pools rather than `limit`
    raw probes, so a trial run finishes every mark of the pools it does
    touch instead of an arbitrary partial set."""
    seen: list = []
    limited = []
    for probe in plan:
        pool_id = probe["pool"]["pool"]
        if pool_id not in seen:
            if len(seen) >= limit:
                continue
            seen.append(pool_id)
        limited.append(probe)
    return limited


# --- probing: batched, widening, retried -----------------------------------
def _swap_request(pool_id: str, from_block: int, to_block: int) -> dict:
    return {
        "method": "eth_getLogs",
        "params": [
            {
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "address": POOL_MANAGER,
                "topics": [TOPIC_V4_SWAP, [pool_id]],
            }
        ],
    }


def _last_swap(logs: list) -> Optional[dict]:
    if not logs:
        return None
    decoded = [decode_swap(log) for log in logs]
    decoded.sort(key=lambda s: (s["block"], s["logIndex"]))
    return decoded[-1]


def _send_logs_batch(rpc_client, requests: list) -> list:
    """One JSON-RPC batch of up to CHUNK_SIZE eth_getLogs calls. A whole-
    batch transport fault (429/5xx) or malformed response is already
    retried inside rpc.RpcClient.call_batch with its own backoff; this
    retries an individual item that came back with no result (an error
    for that one request) the same way rpc.get_logs retries a single
    request -- a busy endpoint must never be read as an empty window
    (OUTCOMES-BACKFILL-BRIEF.md step 2). Only a genuinely empty result
    array is treated as "no swaps here"."""
    pending = list(range(len(requests)))
    results: list = [None] * len(requests)
    delay = BACKOFF_BASE_SECONDS
    for attempt in range(MAX_RETRIES):
        batch = [requests[i] for i in pending]
        raw = rpc_client.call_batch(batch)
        still_pending = []
        for idx, value in zip(pending, raw):
            if value is None:
                still_pending.append(idx)
            else:
                results[idx] = value
        pending = still_pending
        if not pending:
            return results
        if attempt == MAX_RETRIES - 1:
            break
        time.sleep(delay)
        delay = min(delay * 2, BACKOFF_CAP_SECONDS)
    raise RuntimeError(f"backfill: eth_getLogs gave no result after retries for {len(pending)} probe(s)")


def _make_point(probe: dict, swap: dict, width: int, pair_tokens: dict) -> dict:
    pool_record = probe["pool"]
    price = _price_of_swap(swap, pool_record["token"], pool_record["pair"], pair_tokens)
    return {
        "pool": pool_record["pool"],
        "token": pool_record["token"],
        "mark": probe["label"],
        "markBlock": probe["mark_block"],
        "markTs": probe["mark_ts"],
        "price": None if price is None else format(price, "f"),
        "noTrade": False,
        "readAtBlock": swap["block"],
        "windowBlocks": width,
        "source": "backfill-probe",
    }


def _make_no_trade_point(probe: dict, width: int) -> dict:
    pool_record = probe["pool"]
    return {
        "pool": pool_record["pool"],
        "token": pool_record["token"],
        "mark": probe["label"],
        "markBlock": probe["mark_block"],
        "markTs": probe["mark_ts"],
        "price": None,
        "noTrade": True,
        "readAtBlock": None,
        "windowBlocks": width,
        "source": "backfill-probe",
    }


def _resolve_chunk(rpc_client, chunk: list, pair_tokens: dict) -> list:
    """Widens 500 -> 3,000 -> 15,000 blocks, per probe independently,
    batching every still-unresolved probe in the chunk into one JSON-RPC
    request per width. The last swap in the first non-empty width wins;
    all three empty writes noTrade at windowBlocks=15000."""
    pending_idx = list(range(len(chunk)))
    points: list = [None] * len(chunk)
    for width in WIDTHS:
        if not pending_idx:
            break
        requests = [
            _swap_request(
                chunk[i]["pool"]["pool"],
                max(chunk[i]["pool"]["block"], chunk[i]["mark_block"] - width + 1),
                chunk[i]["mark_block"],
            )
            for i in pending_idx
        ]
        results = _send_logs_batch(rpc_client, requests)
        still_pending = []
        for i, logs in zip(pending_idx, results):
            swap = _last_swap(logs)
            if swap is None:
                still_pending.append(i)
                continue
            points[i] = _make_point(chunk[i], swap, width, pair_tokens)
        pending_idx = still_pending
        if pending_idx:
            time.sleep(LOG_PACING_SECONDS)
    for i in pending_idx:
        points[i] = _make_no_trade_point(chunk[i], WIDTHS[-1])
    return points


def _append_backfill_points(data_dir, points: list) -> None:
    if not points:
        return
    path = Path(data_dir) / POOLS_DIR / "backfill.jsonl"
    existing_text = path.read_text() if path.exists() else ""
    existing_keys = {(json.loads(l)["pool"], json.loads(l)["mark"]) for l in existing_text.splitlines() if l.strip()}
    added = [p for p in points if (p["pool"], p["mark"]) not in existing_keys]
    if not added:
        return
    new_text = existing_text + "".join(json.dumps(p) + "\n" for p in added)
    _atomic_write_text(path, new_text)


def run(data_dir, rpc_client, limit_pools: Optional[int] = None) -> dict:
    data_dir = Path(data_dir)
    state = json.loads((data_dir / "state.json").read_text())
    pair_tokens_path = data_dir / "pair-tokens.json"
    pair_tokens = json.loads(pair_tokens_path.read_text()) if pair_tokens_path.exists() else {}

    new_index_records = find_pools(data_dir, rpc_client, state)
    if new_index_records:
        write = plan_pool_index_write(data_dir, new_index_records)
        if write:
            path, payload = write
            _atomic_write_bytes(path, payload)
        _log(f"backfill: indexed {len(new_index_records)} new pons pools")

    plan = build_probe_plan(data_dir, state)
    if limit_pools is not None:
        plan = _limit_to_n_pools(plan, limit_pools)

    _log(f"backfill: {len(plan)} marks to probe")
    probed = 0
    for start in range(0, len(plan), CHUNK_SIZE):
        chunk = plan[start : start + CHUNK_SIZE]
        points = _resolve_chunk(rpc_client, chunk, pair_tokens)
        _append_backfill_points(data_dir, points)
        probed += len(chunk)
        _log(f"backfill: [{probed}/{len(plan)}] probed")

    return {"poolsIndexed": len(new_index_records), "marksProbed": len(plan)}


if __name__ == "__main__":
    import argparse
    import os

    from pipeline.rpc import RpcClient

    parser = argparse.ArgumentParser(description="Probe +1h/+24h/+7d prices for pons pools, once, resumably.")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--limit-pools", type=int, default=None, help="probe only the first N pools (a first trial)")
    args = parser.parse_args()

    url = os.environ.get("RPC_URL") or "https://rpc.mainnet.chain.robinhood.com"
    client = RpcClient(url)
    outcome = run(Path(args.data_dir), client, limit_pools=args.limit_pools)
    print(f"backfill: pools indexed={outcome['poolsIndexed']} marks probed={outcome['marksProbed']}")
