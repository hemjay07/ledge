"""Incremental crawl: windows, resume, dedupe, all-or-nothing commit, gz
rotation. Binding rules: ARCHITECTURE.md section 4/5. Supersedes crawl0.py.

A single run reads state.json, scans new blocks in <=1,000-block windows,
fetches block timestamps, dedupes on (txHash, logIndex), enriches, and
accumulates everything in memory.

Commit guarantee (ARCHITECTURE.md section 4 step 6): *every* output --
partition payloads, the merged/rotated .jsonl.gz archives, pair-tokens.json,
number.json and state.json -- is computed into memory first. Nothing touches
the data directory until the last stage (build_number + canonical
serialization) has returned successfully; only then does the run write each
payload to a sibling `.tmp` and os.replace it into place, in the order
partitions -> rotations -> pair-tokens -> number.json -> state.json. A
failure at any earlier point -- an RPC error, a missing block header, a stats
bug -- leaves the data directory byte-for-byte unchanged, leaves state.json
pointing at the old lastIndexedBlock, and leaves no `.tmp` files behind, so
the next run re-scans exactly the same range.

Three ordering consequences of that guarantee are load-bearing:

  - Timestamps are fetched for *every* scanned record, before dedupe, because
    the partition a record belongs to (and therefore the set of partitions the
    dedupe must consult) is decided by its block timestamp, never by the run's
    wall clock. After an outage the reorg re-scan can reach blocks that are
    days older than `now`.
  - Orphan status is decided against every launch token LEDGE has ever
    recorded (loaded from the existing partitions, plain and .gz), not just
    the launches new in this run. In steady state most graduations belong to
    launches from earlier runs.
  - Rotation merges into an existing archive rather than replacing it: after
    an outage crossing midnight a day can have both `D.jsonl.gz` and a fresh
    `D.jsonl`.
"""
from __future__ import annotations

import gzip
import io
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

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


# --- record / partition primitives -------------------------------------------
def _record_key(record: dict) -> tuple:
    return (record.get("txHash"), record.get("logIndex"))


def _merge_dedupe(*groups: Iterable[dict]) -> list:
    """Concatenate record groups in order, dropping any record whose
    (txHash, logIndex) has already been seen. Records carrying no txHash at
    all are not dedupe-able and pass through untouched."""
    seen: set = set()
    merged: list = []
    for group in groups:
        for record in group:
            key = _record_key(record)
            if key != (None, None):
                if key in seen:
                    continue
                seen.add(key)
            merged.append(record)
    return merged


def _jsonl_text(records: Iterable[dict]) -> str:
    return "".join(json.dumps(r) + "\n" for r in records)


def _parse_jsonl(text: str) -> list:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _read_partition_file(path: Path) -> list:
    opener = gzip.open if path.name.endswith(".gz") else open
    with opener(path, "rt") as f:
        return _parse_jsonl(f.read())


def _gzip_bytes(data: bytes) -> bytes:
    """Deterministic gzip (ARCHITECTURE.md section 5): empty filename field,
    mtime=0, compresslevel=9, so re-running a rotation is byte-identical."""
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", mtime=0, fileobj=buf, compresslevel=9) as gz:
        gz.write(data)
    return buf.getvalue()


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(payload)
    tmp.replace(path)


def _partition_days(kind_dir: Path) -> set:
    """Days that currently have a *plain* partition file on disk."""
    days = set()
    if not kind_dir.exists():
        return days
    for path in kind_dir.glob("*.jsonl"):
        try:
            days.add(date.fromisoformat(path.stem))
        except ValueError:
            continue
    return days


def plan_partition_writes(data_dir, today: date, new_by_day: Optional[dict] = None) -> tuple:
    """Compute (writes, deletes) for the partition layer without touching disk.

    `writes` is a list of (final_path, payload_bytes); `deletes` is the plain
    files superseded by a rotation. Days at or after `today` stay plain and
    are appended to byte-for-byte (existing lines are never re-serialized).
    Days before `today` are rewritten as a single deterministic `.jsonl.gz`
    holding the existing archive, the existing plain file and this run's new
    records merged in that order and deduped on (txHash, logIndex) -- so a
    fresh `D.jsonl` appearing beside an existing `D.jsonl.gz` after an
    overnight outage merges into the archive instead of replacing it.
    """
    data_dir = Path(data_dir)
    new_by_day = new_by_day or {}
    writes: list = []
    deletes: list = []

    for kind in ("launches", "graduations"):
        kind_dir = data_dir / kind
        pending = new_by_day.get(kind, {})
        for day in sorted(_partition_days(kind_dir) | set(pending)):
            plain = kind_dir / f"{day.isoformat()}.jsonl"
            archive = kind_dir / f"{day.isoformat()}.jsonl.gz"
            new_records = pending.get(day, [])

            if day >= today:
                existing_text = plain.read_text() if plain.exists() else ""
                existing_keys = {_record_key(r) for r in _parse_jsonl(existing_text)}
                added = [r for r in new_records if _record_key(r) not in existing_keys]
                if not added:
                    continue
                writes.append((plain, (existing_text + _jsonl_text(added)).encode()))
                continue

            if not new_records and not plain.exists():
                continue  # already archived and untouched: leave the .gz alone
            archived = _read_partition_file(archive) if archive.exists() else []
            current = _read_partition_file(plain) if plain.exists() else []
            merged = _merge_dedupe(archived, current, new_records)
            writes.append((archive, _gzip_bytes(_jsonl_text(merged).encode())))
            if plain.exists():
                deletes.append(plain)

    return writes, deletes


def rotate_partitions(data_dir, today: Optional[date] = None) -> None:
    """Fold every plain partition older than `today` into its deterministic
    `.jsonl.gz`, merging with an existing archive rather than overwriting it,
    and delete the plain file."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    writes, deletes = plan_partition_writes(data_dir, today)
    for path, payload in writes:
        _atomic_write_bytes(path, payload)
    for path in deletes:
        path.unlink()


def dedupe_day_set(timestamps: Iterable[int]) -> set:
    """The UTC days whose partitions can hold a record with one of these
    timestamps, plus a day either side.

    Derived from the records about to be written, never from `now`: the
    reorg re-scan after an outage reaches blocks days older than the run's
    wall clock, and keying this off `now` would miss those partitions and
    re-append every record in them.
    """
    days: set = set()
    for ts in timestamps:
        day = datetime.fromtimestamp(ts, timezone.utc).date()
        days.update({day - timedelta(days=1), day, day + timedelta(days=1)})
    return days


def _load_existing_keys(data_dir: Path, kind: str, days: set) -> set:
    keys = set()
    for day in days:
        for suffix in (".jsonl", ".jsonl.gz"):
            path = data_dir / kind / f"{day.isoformat()}{suffix}"
            if not path.exists():
                continue
            for record in _read_partition_file(path):
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
        "ts": decoded.get("ts"),
        "pairTokenAmount": str(decoded["pairTokenAmount"]),
        "orphan": decoded["token"] not in launch_tokens,
        "txHash": decoded["txHash"],
        "logIndex": decoded["logIndex"],
    }


def _group_by_day(records: list) -> dict:
    by_day: dict = {}
    for record in records:
        day = datetime.fromtimestamp(record["ts"], timezone.utc).date()
        by_day.setdefault(day, []).append(record)
    return by_day


def run(data_dir, rpc_client, head_block: Optional[int] = None, now: Optional[datetime] = None,
        backfill_hours: Optional[int] = None) -> dict:
    data_dir = Path(data_dir)
    state_path = data_dir / "state.json"
    pair_tokens_path = data_dir / "pair-tokens.json"
    state = json.loads(state_path.read_text())
    pair_tokens = json.loads(pair_tokens_path.read_text()) if pair_tokens_path.exists() else {}

    if head_block is None:
        head_block = rpc_client.get_head_block()

    # Three modes. First run: from head (or `backfill_hours` behind it).
    # Incremental: resume behind the cursor by the reorg window. Backfill with
    # history: extend backwards from firstIndexedBlock and leave the forward
    # cursor alone; dedupe absorbs any overlap.
    backfilling_history = backfill_hours is not None and state.get("firstIndexedBlock") is not None
    if backfilling_history:
        blocks_back = int(backfill_hours * 3600 / AVG_BLOCK_SECONDS)
        start_block = max(0, state["firstIndexedBlock"] - blocks_back)
        to_block = state["firstIndexedBlock"] - 1
    elif state.get("firstIndexedBlock") is None:
        if backfill_hours is not None:
            blocks_back = int(backfill_hours * 3600 / AVG_BLOCK_SECONDS)
            start_block = max(0, head_block - blocks_back)
        else:
            start_block = head_block  # first run with no backfill: start from head
        to_block = head_block
    else:
        start_block = resume_start_block(state)
        to_block = head_block

    windows = plan_windows(start_block, to_block)

    raw_launches = []
    raw_grads = []
    _log(f"crawl: {len(windows)} windows, blocks {start_block}-{to_block}")
    for i, (frm, to) in enumerate(windows, 1):
        if i % 10 == 0 or i == len(windows):
            _log(f"crawl: [{i}/{len(windows)}] launches={len(raw_launches)} grads={len(raw_grads)}")
        for log in rpc_client.get_logs(frm, to, TOPIC_TOKEN_LAUNCHED):
            raw_launches.append(decode_token_launched(log))
        time.sleep(LOG_PACING_SECONDS)
        for log in rpc_client.get_logs(frm, to, TOPIC_POOL_GRADUATED):
            raw_grads.append(decode_pool_graduated(log))
        time.sleep(LOG_PACING_SECONDS)

    if now is None:
        now = datetime.now(timezone.utc)
    today = now.date()

    # Timestamps come before dedupe: a record's partition -- and so the set of
    # partitions the dedupe has to consult -- is decided by its block
    # timestamp, not by the run's wall clock.
    scanned = [_shape_launch(l) for l in raw_launches]
    _log(f"crawl: logs done, timestamping {len(scanned) + len(raw_grads)} records")
    timestamps = _fetch_block_timestamps(
        rpc_client, [r["block"] for r in scanned] + [g["block"] for g in raw_grads]
    )
    for record in scanned:
        record["ts"] = timestamps[record["block"]]
    for record in raw_grads:
        record["ts"] = timestamps[record["block"]]

    days_to_check = dedupe_day_set(timestamps.values())
    new_launches = dedupe_records(scanned, _load_existing_keys(data_dir, "launches", days_to_check))
    new_grads = dedupe_records(raw_grads, _load_existing_keys(data_dir, "graduations", days_to_check))

    if not new_launches and not new_grads and head_block == state["lastIndexedBlock"]:
        return {"committed": False}

    existing_launches = load_partitions(data_dir / "launches")
    existing_grads = load_partitions(data_dir / "graduations")

    _log(f"crawl: enriching {len(new_launches)} new launches")
    enrichment_failures = 0
    enriched_launches: list = []
    if new_launches:
        enriched_launches, enrichment_failures = enrich_mod.enrich_launches(new_launches, rpc_client, pair_tokens)

    # Orphan is decided against every launch token LEDGE has ever recorded --
    # the existing partitions plus this run's new launches -- so a token that
    # launched hours ago and graduates now is not mislabelled.
    known_launch_tokens = {l["token"] for l in existing_launches}
    known_launch_tokens.update(l["token"] for l in enriched_launches)
    shaped_grads = [_shape_graduation(g, known_launch_tokens) for g in new_grads]

    all_launches = _merge_dedupe(existing_launches, enriched_launches)
    all_grads = _merge_dedupe(existing_grads, shaped_grads)
    for launch in all_launches:
        launch["pairClass"] = resolve_pair_class(launch, pair_tokens)

    # --- stage every output in memory ------------------------------------
    partition_writes, partition_deletes = plan_partition_writes(
        data_dir,
        today,
        {"launches": _group_by_day(enriched_launches), "graduations": _group_by_day(shaped_grads)},
    )
    pair_tokens_payload = (json.dumps(pair_tokens, sort_keys=True, indent=2) + "\n").encode()

    new_state = dict(state)
    if backfilling_history:
        new_state["firstIndexedBlock"] = start_block
    else:
        new_state["lastIndexedBlock"] = head_block
        if new_state.get("firstIndexedBlock") is None:
            new_state["firstIndexedBlock"] = start_block
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    new_state["lastRunAt"] = now_iso
    new_state["lastSuccessAt"] = now_iso
    new_state["consecutiveFailures"] = 0
    new_state["lastError"] = None
    # orphanGraduations is re-derived against the full launch set, exactly as
    # stats.window does, so the count in state.json always agrees with
    # number.json even where an older partition line carries a stale snapshot.
    all_launch_tokens = {l["token"] for l in all_launches}
    new_state["counts"] = {
        "launches": len(all_launches),
        "graduations": len(all_grads),
        "orphanGraduations": sum(1 for g in all_grads if g["token"] not in all_launch_tokens),
        "enrichmentFailures": enrichment_failures,
    }

    number_payload = canonical_dumps(build_number(all_launches, all_grads, new_state, now_iso)).encode()
    state_payload = (json.dumps(new_state, sort_keys=True, indent=2) + "\n").encode()

    # --- commit point: nothing above this line touched the data dir -------
    for path, payload in partition_writes:
        _atomic_write_bytes(path, payload)
    for path in partition_deletes:
        path.unlink()
    _atomic_write_bytes(pair_tokens_path, pair_tokens_payload)
    _atomic_write_bytes(data_dir / "number.json", number_payload)
    _atomic_write_bytes(state_path, state_payload)

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
