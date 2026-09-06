"""Incremental crawl: windows, resume, dedupe, all-or-nothing commit, gz
rotation. Binding rules: ARCHITECTURE.md section 4/5. Supersedes crawl0.py.

A single run: read state.json, scan new blocks in <=1,000-block windows,
dedupe on (txHash, logIndex), enrich, timestamp, accumulate everything in
memory, and only then commit -- partitions, pair-tokens.json, number.json,
state.json. Any unrecoverable failure before the commit point writes
nothing, so the next run re-scans the same range.
"""
from __future__ import annotations

import gzip
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

if __package__ in (None, ""):
    # allows `python pipeline/crawl.py` (no PYTHONPATH) as used by the
    # workflows, while leaving package-context imports (pytest) untouched.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import enrich as enrich_mod
from pipeline.canonical import canonical_dumps
from pipeline.recompute import load_partitions, resolve_pair_class
from pipeline.rpc import TOPIC_POOL_GRADUATED, TOPIC_TOKEN_LAUNCHED, decode_pool_graduated, decode_token_launched
from pipeline.stats import build_number

REORG_WINDOW = 3000
MAX_WINDOW_BLOCKS = 1000
LOG_PACING_SECONDS = 0.9


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)
AVG_BLOCK_SECONDS = 0.101  # crawl0.py-measured, used only to size a first backfill

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def resume_start_block(state: dict) -> int:
    return max(state["firstIndexedBlock"], state["lastIndexedBlock"] - REORG_WINDOW + 1)


def plan_windows(start_block: int, head_block: int) -> list:
    if start_block > head_block:
        return []
    windows = []
    frm = start_block
    while frm <= head_block:
        to = min(frm + MAX_WINDOW_BLOCKS - 1, head_block)
        windows.append((frm, to))
        frm = to + 1
    return windows


def dedupe_records(records: list, existing_keys: set) -> list:
    return [r for r in records if (r["txHash"], r["logIndex"]) not in existing_keys]


def _write_gzip_deterministic(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", mtime=0, fileobj=raw, compresslevel=9) as gz:
            gz.write(data)
    tmp.replace(path)


def rotate_partitions(data_dir, today: Optional[date] = None) -> None:
    """Gzip every plain partition older than `today`, deterministically."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    data_dir = Path(data_dir)
    for kind in ("launches", "graduations"):
        kind_dir = data_dir / kind
        if not kind_dir.exists():
            continue
        for path in sorted(kind_dir.glob("*.jsonl")):
            try:
                partition_date = date.fromisoformat(path.stem)
            except ValueError:
                continue
            if partition_date >= today:
                continue
            _write_gzip_deterministic(path.with_name(path.name + ".gz"), path.read_bytes())
            path.unlink()


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(content)
    tmp.replace(path)


def _append_jsonl(path: Path, records: list) -> None:
    if not records:
        return
    existing = path.read_text() if path.exists() else ""
    added = "".join(json.dumps(r) + "\n" for r in records)
    _atomic_write_text(path, existing + added)


def _load_existing_keys(data_dir: Path, kind: str, days: set) -> set:
    keys = set()
    for day in days:
        for suffix in (".jsonl", ".jsonl.gz"):
            path = data_dir / kind / f"{day.isoformat()}{suffix}"
            if not path.exists():
                continue
            opener = gzip.open if suffix == ".jsonl.gz" else open
            with opener(path, "rt") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        record = json.loads(line)
                        keys.add((record["txHash"], record["logIndex"]))
    return keys


def _fetch_block_timestamps(rpc_client, blocks: list) -> dict:
    unique_blocks = sorted(set(blocks))
    if not unique_blocks:
        return {}
    requests = [{"method": "eth_getBlockByNumber", "params": [hex(b), False]} for b in unique_blocks]
    results = rpc_client.call_batch(requests)
    timestamps = {}
    for block, result in zip(unique_blocks, results):
        if not result:
            raise RuntimeError(f"crawl: missing block header for block {block}")
        timestamps[block] = int(result["timestamp"], 16)
    return timestamps


def _shape_launch(decoded: dict) -> dict:
    return {
        "token": decoded["token"],
        "curve": decoded["curve"],
        "deployer": decoded["deployer"],
        "pairToken": decoded["pairToken"],
        "pairClass": None,
        "creatorTaxBps": None,
        "block": decoded["block"],
        "ts": None,
        "txHash": decoded["txHash"],
        "logIndex": decoded["logIndex"],
    }


def _shape_graduation(decoded: dict, launch_tokens: set) -> dict:
    return {
        "token": decoded["token"],
        "block": decoded["block"],
        "ts": None,
        "pairTokenAmount": str(decoded["pairTokenAmount"]),
        "orphan": decoded["token"] not in launch_tokens,
        "txHash": decoded["txHash"],
        "logIndex": decoded["logIndex"],
    }


def run(data_dir, rpc_client, head_block: Optional[int] = None, now: Optional[datetime] = None,
        backfill_hours: Optional[int] = None) -> dict:
    data_dir = Path(data_dir)
    state_path = data_dir / "state.json"
    pair_tokens_path = data_dir / "pair-tokens.json"
    state = json.loads(state_path.read_text())
    pair_tokens = json.loads(pair_tokens_path.read_text()) if pair_tokens_path.exists() else {}

    if head_block is None:
        head_block = rpc_client.get_head_block()

    if state.get("firstIndexedBlock") is None:
        if backfill_hours is not None:
            blocks_back = int(backfill_hours * 3600 / AVG_BLOCK_SECONDS)
            start_block = max(0, head_block - blocks_back)
        else:
            start_block = head_block  # first run with no backfill: start from head
    else:
        start_block = resume_start_block(state)

    windows = plan_windows(start_block, head_block)

    raw_launches = []
    raw_grads = []
    _log(f"crawl: {len(windows)} windows, blocks {start_block}-{head_block}")
    for i, (frm, to) in enumerate(windows, 1):
        if i % 10 == 0 or i == len(windows):
            _log(f"crawl: [{i}/{len(windows)}] launches={len(raw_launches)} grads={len(raw_grads)}")
        for log in rpc_client.get_logs(frm, to, TOPIC_TOKEN_LAUNCHED):
            raw_launches.append(decode_token_launched(log))
        time.sleep(LOG_PACING_SECONDS)
        for log in rpc_client.get_logs(frm, to, TOPIC_POOL_GRADUATED):
            raw_grads.append(decode_pool_graduated(log))
        time.sleep(LOG_PACING_SECONDS)

    _log(f"crawl: logs done, enriching {len(raw_launches)} launches")
    if now is None:
        now = datetime.now(timezone.utc)
    days_to_check = {now.date(), (now - timedelta(days=1)).date()}
    existing_launch_keys = _load_existing_keys(data_dir, "launches", days_to_check)
    existing_grad_keys = _load_existing_keys(data_dir, "graduations", days_to_check)

    new_launches = dedupe_records(raw_launches, existing_launch_keys)
    new_grads = dedupe_records(raw_grads, existing_grad_keys)

    if not new_launches and not new_grads and head_block == state["lastIndexedBlock"]:
        return {"committed": False}

    enrichment_failures = 0
    enriched_launches = []
    if new_launches:
        shaped_launches = [_shape_launch(l) for l in new_launches]
        enriched_launches, enrichment_failures = enrich_mod.enrich_launches(shaped_launches, rpc_client, pair_tokens)

    launch_tokens = {l["token"] for l in enriched_launches}
    shaped_grads = [_shape_graduation(g, launch_tokens) for g in new_grads]

    blocks_needing_ts = [l["block"] for l in enriched_launches] + [g["block"] for g in shaped_grads]
    timestamps = _fetch_block_timestamps(rpc_client, blocks_needing_ts)
    for l in enriched_launches:
        l["ts"] = timestamps[l["block"]]
    for g in shaped_grads:
        g["ts"] = timestamps[g["block"]]

    launches_by_day: dict = {}
    for l in enriched_launches:
        day = datetime.fromtimestamp(l["ts"], timezone.utc).date()
        launches_by_day.setdefault(day, []).append(l)
    grads_by_day: dict = {}
    for g in shaped_grads:
        day = datetime.fromtimestamp(g["ts"], timezone.utc).date()
        grads_by_day.setdefault(day, []).append(g)

    # --- commit point: everything above is in-memory only -----------------
    for day, records in launches_by_day.items():
        _append_jsonl(data_dir / "launches" / f"{day.isoformat()}.jsonl", records)
    for day, records in grads_by_day.items():
        _append_jsonl(data_dir / "graduations" / f"{day.isoformat()}.jsonl", records)

    _atomic_write_text(pair_tokens_path, json.dumps(pair_tokens, sort_keys=True, indent=2) + "\n")
    rotate_partitions(data_dir, today=now.date())

    all_launches = load_partitions(data_dir / "launches")
    all_grads = load_partitions(data_dir / "graduations")
    for l in all_launches:
        l["pairClass"] = resolve_pair_class(l, pair_tokens)

    new_state = dict(state)
    new_state["lastIndexedBlock"] = head_block
    if new_state.get("firstIndexedBlock") is None:
        new_state["firstIndexedBlock"] = start_block
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    new_state["lastRunAt"] = now_iso
    new_state["lastSuccessAt"] = now_iso
    new_state["consecutiveFailures"] = 0
    new_state["lastError"] = None
    new_state["counts"] = {
        "launches": len(all_launches),
        "graduations": len(all_grads),
        "orphanGraduations": sum(1 for g in all_grads if g.get("orphan")),
        "enrichmentFailures": enrichment_failures,
    }

    number = build_number(all_launches, all_grads, new_state, now_iso)
    _atomic_write_text(data_dir / "number.json", canonical_dumps(number))
    _atomic_write_text(state_path, json.dumps(new_state, sort_keys=True, indent=2) + "\n")

    return {"committed": True, "state": new_state}


if __name__ == "__main__":
    import argparse
    import os

    from pipeline.rpc import RpcClient

    parser = argparse.ArgumentParser(description="Crawl new TokenLaunched/PoolGraduated events.")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--backfill-hours", type=int, default=None)
    args = parser.parse_args()

    url = os.environ.get("RPC_URL") or "https://rpc.mainnet.chain.robinhood.com"
    client = RpcClient(url)
    outcome = run(Path(args.data_dir), client, backfill_hours=args.backfill_hours)
    print(f"crawl: committed={outcome.get('committed')}")
