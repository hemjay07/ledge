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
  - `lastIndexedAt` -- the block timestamp of `lastIndexedBlock`, and the
    `crawledAt` the whole site keys on -- is read from a block header, moves
    only when the cursor moves, and is never the run's wall clock. A
    backwards backfill leaves the cursor alone and so leaves it alone too.
"""
from __future__ import annotations

import gzip
import io
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Iterable, Optional

if __package__ in (None, ""):
    # allows `python pipeline/crawl.py` (no PYTHONPATH) as used by the
    # workflows, while leaving package-context imports (pytest) untouched.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import enrich as enrich_mod
from pipeline.canonical import canonical_dumps
from pipeline.pool import (
    POOL_MANAGER,
    TOPIC_V4_INITIALIZE,
    TOPIC_V4_SWAP,
    decode_initialize,
    decode_swap,
    is_pons_pool,
    quote_per_token,
)
from pipeline.recompute import crawled_at_for, load_partitions, load_samples, resolve_pair_class
from pipeline.rpc import TOPIC_POOL_GRADUATED, TOPIC_TOKEN_LAUNCHED, decode_pool_graduated, decode_token_launched
from pipeline.stats import build_number, format_iso

REORG_WINDOW = 3000
MAX_WINDOW_BLOCKS = 1000
LOG_PACING_SECONDS = 0.9
# The furthest one forward run will reach. A backlog must never produce a run
# that cannot finish inside the job's timeout: this crawl is all-or-nothing, so
# a run that is killed commits nothing, and the next hour starts an hour
# further behind. That is what happened on 2026-09-07 -- 21 hours of backlog,
# ~750,000 blocks per attempt, every run cancelled at 20 minutes, no progress
# ever committed. Capped, each run commits what it reached and the next one
# continues from there, so a backlog drains instead of compounding.
# 200,000 blocks is ~5.6 hours of chain and measured ~15 minutes of work
# (log windows, block headers, and the factory read for each new launch).
MAX_FORWARD_BLOCKS = 200_000


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


# --- pool (Uniswap v4) primitives ---------------------------------------
# OUTCOMES.md: prices for what happens after a graduation come only from
# Initialize and Swap logs on the single PoolManager pons graduates into,
# never from reading pool state at a past block. pipeline/pool.py (step 1,
# already merged) owns the log decoding and the sqrtPriceX96 math; this
# section folds those logs into the two data/pools/ partitions under the
# same all-or-nothing commit as launches and graduations.
POOLS_DIR = "pools"


def _pool_orientation(currency0: str, currency1: str, known_launch_tokens: set) -> tuple:
    """Which currency is the pons launch token and which is the pair,
    decided against every launch token LEDGE has ever recorded -- not just
    this run's. Neither side matching (or, degenerately, both) is not
    guessed: both come back None and the index line says so."""
    c0_is_launch = currency0 in known_launch_tokens
    c1_is_launch = currency1 in known_launch_tokens
    if c0_is_launch and not c1_is_launch:
        return currency0, currency1
    if c1_is_launch and not c0_is_launch:
        return currency1, currency0
    return None, None


def _shape_pool_index(decoded: dict, known_launch_tokens: set) -> dict:
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


def _pool_token_is_currency0(token: str, pair: str) -> bool:
    """Uniswap v4 requires a pool's currency0 < currency1 by address value
    (the PoolManager rejects any PoolKey that isn't sorted that way), so
    which side the launched token sits on is recoverable from the two
    addresses alone -- nothing extra needs to be stored in the index line
    to price a later swap correctly."""
    return int(token, 16) < int(pair, 16)


def _pool_pair_decimals(address: str, pair_tokens: dict) -> Optional[int]:
    """Decimals for the pair (quote) side of a pool. ETH (the zero
    address) is always 18; anything else must carry an explicit
    "decimals" field in pair-tokens.json or the price is unknown -- never
    guessed."""
    if address == ZERO_ADDRESS:
        return 18
    entry = pair_tokens.get(address)
    return entry.get("decimals") if entry else None


def _pool_token_decimals(address: str, pair_tokens: dict) -> int:
    """Decimals for the launched-token side: 18 (pons's standard supply),
    unless pair-tokens.json records something different for this address
    (it can also appear there if the same token is later approved as a
    pair token elsewhere)."""
    entry = pair_tokens.get(address)
    if entry and "decimals" in entry:
        return entry["decimals"]
    return 18


def _pool_price(sqrt_price_x96: int, token: Optional[str], pair: Optional[str], pair_tokens: dict):
    """quote-per-token at this swap's sqrtPriceX96, or None if the
    orientation or either side's decimals is unknown. Reuses
    pool.quote_per_token, which needs the pool's real currency0/currency1
    identities -- recovered via _pool_token_is_currency0 rather than
    stored, since sqrtPriceX96 is meaningless without that ordering."""
    if token is None or pair is None:
        return None
    if _pool_token_is_currency0(token, pair):
        currency0, currency1 = token, pair
        decimals0 = _pool_token_decimals(token, pair_tokens)
        decimals1 = _pool_pair_decimals(pair, pair_tokens)
    else:
        currency0, currency1 = pair, token
        decimals0 = _pool_pair_decimals(pair, pair_tokens)
        decimals1 = _pool_token_decimals(token, pair_tokens)
    return quote_per_token(sqrt_price_x96, currency0, currency1, token, decimals0, decimals1)


def _pool_quote_amount(decoded_swap: dict, token: Optional[str], pair: Optional[str]) -> Optional[int]:
    """The absolute raw (base-unit) amount on the pair side of a swap --
    needs only the orientation, never decimals, since volumeQuote is a raw
    count like pairTokenAmount elsewhere in this file."""
    if token is None or pair is None:
        return None
    quote_is_currency1 = _pool_token_is_currency0(token, pair)
    raw = decoded_swap["amount1"] if quote_is_currency1 else decoded_swap["amount0"]
    return abs(raw)


def _pool_hour_key(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H")


def _new_pool_bar(pool_id: str, token: Optional[str], hour: str) -> dict:
    return {
        "pool": pool_id, "token": token, "hour": hour,
        "open": None, "close": None, "high": None, "low": None,
        "swaps": 0, "volumeQuote": "0",
    }


def _fold_swap_into_bar(bar: dict, price, quote_amount: Optional[int]) -> None:
    bar["swaps"] += 1
    if quote_amount is not None:
        bar["volumeQuote"] = str(Decimal(bar["volumeQuote"]) + Decimal(quote_amount))
    if price is None:
        return
    price_str = format(price, "f")
    if bar["open"] is None:
        bar["open"] = price_str
    bar["close"] = price_str
    if bar["high"] is None or price > Decimal(bar["high"]):
        bar["high"] = price_str
    if bar["low"] is None or price < Decimal(bar["low"]):
        bar["low"] = price_str


def build_pool_bars(new_swaps: list, pool_index_by_id: dict, pair_tokens: dict) -> dict:
    """Fold this run's new Swap records into hour bars, one per
    (pool, hour). A swap for a pool whose orientation is unknown (index
    line carries token: null) is not folded -- there is no way to tell
    which side is the quote amount without guessing."""
    bars: dict = {}
    for swap in new_swaps:
        pool_record = pool_index_by_id.get(swap["id"])
        if pool_record is None:
            continue
        token, pair = pool_record["token"], pool_record["pair"]
        if token is None or pair is None:
            continue
        hour = _pool_hour_key(swap["ts"])
        key = (swap["id"], hour)
        bar = bars.get(key) or _new_pool_bar(swap["id"], token, hour)
        price = _pool_price(swap["sqrtPriceX96"], token, pair, pair_tokens)
        quote_amount = _pool_quote_amount(swap, token, pair)
        _fold_swap_into_bar(bar, price, quote_amount)
        bars[key] = bar
    return bars


def _merge_pool_bar(existing: Optional[dict], new: Optional[dict]) -> dict:
    """An hour bar already on disk is merged with this run's, not
    replaced: open is the earliest, close is the latest, high/low the
    extremes, swaps and volumeQuote add up. Runs proceed forward through
    the chain, so an on-disk bar predates this run's batch; the one
    exception is a backward backfill, which OUTCOMES.md's own order of
    work runs once, before anything is published, into hours that have no
    forward bar yet -- so it does not hit this ambiguity in practice."""
    if existing is None:
        return new
    if new is None:
        return existing
    merged = {
        "pool": existing["pool"],
        "token": existing["token"] if existing["token"] is not None else new["token"],
        "hour": existing["hour"],
        "swaps": existing["swaps"] + new["swaps"],
        "volumeQuote": str(Decimal(existing["volumeQuote"]) + Decimal(new["volumeQuote"])),
    }
    merged["open"] = existing["open"] if existing["open"] is not None else new["open"]
    merged["close"] = new["close"] if new["close"] is not None else existing["close"]
    highs = [Decimal(v) for v in (existing["high"], new["high"]) if v is not None]
    lows = [Decimal(v) for v in (existing["low"], new["low"]) if v is not None]
    merged["high"] = format(max(highs), "f") if highs else None
    merged["low"] = format(min(lows), "f") if lows else None
    return merged


def _pool_bar_day(bar: dict) -> date:
    return date.fromisoformat(bar["hour"][:10])


def _group_pool_bars_by_day(bars: dict) -> dict:
    by_day: dict = {}
    for bar in bars.values():
        by_day.setdefault(_pool_bar_day(bar), {})[(bar["pool"], bar["hour"])] = bar
    return by_day


def plan_pool_bar_writes(data_dir, today: date, new_bars_by_day: dict) -> tuple:
    """Like plan_partition_writes, but for data/pools/YYYY-MM-DD.jsonl:
    each line is a (pool, hour) aggregate, so a day already on disk is
    read back, merged bar-by-bar with this run's bars via _merge_pool_bar,
    and rewritten whole -- never a byte-for-byte append, because a new
    swap in an hour that already has a bar changes an existing line
    rather than adding one. Days before `today` are merged the same way,
    then gzipped, following the same rule as launches/graduations."""
    data_dir = Path(data_dir)
    pools_dir = data_dir / POOLS_DIR
    writes: list = []
    deletes: list = []

    for day in sorted(_partition_days(pools_dir) | set(new_bars_by_day)):
        plain = pools_dir / f"{day.isoformat()}.jsonl"
        archive = pools_dir / f"{day.isoformat()}.jsonl.gz"
        new_bars = new_bars_by_day.get(day, {})

        if day >= today:
            if not new_bars:
                continue
            existing = {(b["pool"], b["hour"]): b for b in (_read_partition_file(plain) if plain.exists() else [])}
            merged = dict(existing)
            for key, bar in new_bars.items():
                merged[key] = _merge_pool_bar(existing.get(key), bar)
            records = [merged[k] for k in sorted(merged)]
            writes.append((plain, _jsonl_text(records).encode()))
            continue

        if not new_bars and not plain.exists():
            continue  # already archived and untouched: leave the .gz alone
        existing = {
            (b["pool"], b["hour"]): b
            for path in (archive, plain) if path.exists()
            for b in _read_partition_file(path)
        }
        merged = dict(existing)
        for key, bar in new_bars.items():
            merged[key] = _merge_pool_bar(existing.get(key), bar)
        records = [merged[k] for k in sorted(merged)]
        writes.append((archive, _gzip_bytes(_jsonl_text(records).encode())))
        if plain.exists():
            deletes.append(plain)

    return writes, deletes


POOL_INDEX_FILES = ("index.jsonl", "index-backfill.jsonl")


def _load_pool_index(data_dir) -> list:
    """The pool index is two files read as one. `index.jsonl` is what the
    forward crawl discovers as it goes; `index-backfill.jsonl` is what the
    one-time probe (pipeline/backfill_pools.py) found scanning history. They
    are separate files so the probe, which runs on its own clone and pushes
    on its own schedule, can never produce a text conflict with the crawl
    on the same line of the same file. Deduped on (txHash, logIndex) so a
    pool both found is one pool."""
    records = []
    seen = set()
    for name in POOL_INDEX_FILES:
        path = Path(data_dir) / POOLS_DIR / name
        if not path.exists():
            continue
        for record in _parse_jsonl(path.read_text()):
            key = _record_key(record)
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
    return records


def plan_pool_index_write(data_dir, new_index_records: list, filename: str = "index.jsonl") -> Optional[tuple]:
    """data/pools/index.jsonl is a single ever-growing file, one line per
    pons pool (dozens, not thousands) -- appended to and deduped on
    (txHash, logIndex) like every other partition, never rotated to .gz.
    The dedupe consults BOTH index files, so a pool the other writer already
    holds is not written twice; the append goes to `filename` only."""
    if not new_index_records:
        return None
    path = Path(data_dir) / POOLS_DIR / filename
    existing_text = path.read_text() if path.exists() else ""
    existing_keys = {_record_key(r) for r in _load_pool_index(data_dir)}
    added = [r for r in new_index_records if _record_key(r) not in existing_keys]
    if not added:
        return None
    return path, (existing_text + _jsonl_text(added)).encode()


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
        to_block = min(head_block, start_block + MAX_FORWARD_BLOCKS - 1)

    windows = plan_windows(start_block, to_block)

    raw_launches = []
    raw_grads = []
    raw_pool_inits = []
    raw_swaps = []
    # Seeded from data/pools/index.jsonl so a pool discovered in an earlier
    # run has its swaps read from the very first window of this one, not
    # only once this run happens to re-see its Initialize.
    known_pool_ids = {r["pool"] for r in _load_pool_index(data_dir)}
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

        # Initialize is read for the whole window (there is no way to filter
        # it to pons pools server-side: `hooks` lives in the log body, not
        # in an indexed topic) and kept only where is_pons_pool says so.
        # Swap volume across the whole PoolManager is ~100,000/hour
        # (OUTCOMES.md) -- far too much to read raw -- so it is filtered to
        # the pons pool ids known so far, including any this same window's
        # Initialize batch just added, via the second topic position, which
        # the endpoint accepts as an array (OR match; measured 2026-09-12,
        # see rpc.get_logs and the report).
        for log in rpc_client.get_logs(frm, to, TOPIC_V4_INITIALIZE, address=POOL_MANAGER):
            decoded = decode_initialize(log)
            if is_pons_pool(decoded):
                raw_pool_inits.append(decoded)
                known_pool_ids.add(decoded["id"])
        time.sleep(LOG_PACING_SECONDS)
        # Swaps are NOT read here. They were, until 2026-09-12, and it cost
        # the crawl its reliability: pons pools trade hard (twenty of them
        # produced 19,811 swaps in 50,000 blocks), every swap's block needs
        # a header to be placed in an hour, and _fetch_block_timestamps
        # batches fifty headers a request with two seconds between batches.
        # Two scheduled runs in a row were cancelled at the 45-minute
        # timeout with the data uncommitted, which is worse than having no
        # bars at all.
        #
        # The statistics do not need every swap. They need the price of the
        # last swap at or before +1 h, +24 h and +7 d, which
        # pipeline/backfill_pools.py asks for directly, one narrow window
        # per mark, and which stats.py already reads as a probe reading
        # (`fromProbe`). Hour bars stay in the format and the writer stays
        # in place for a future reader that can afford them.

    if now is None:
        now = datetime.now(timezone.utc)
    today = now.date()

    # Timestamps come before dedupe: a record's partition -- and so the set of
    # partitions the dedupe has to consult -- is decided by its block
    # timestamp, not by the run's wall clock.
    scanned = [_shape_launch(l) for l in raw_launches]
    _log(f"crawl: logs done, timestamping {len(scanned) + len(raw_grads)} records")
    timestamps = _fetch_block_timestamps(
        rpc_client,
        [r["block"] for r in scanned] + [g["block"] for g in raw_grads]
        + [p["block"] for p in raw_pool_inits] + [s["block"] for s in raw_swaps],
    )
    for record in scanned:
        record["ts"] = timestamps[record["block"]]
    for record in raw_grads:
        record["ts"] = timestamps[record["block"]]
    for record in raw_pool_inits:
        record["ts"] = timestamps[record["block"]]
    for record in raw_swaps:
        record["ts"] = timestamps[record["block"]]

    days_to_check = dedupe_day_set(timestamps.values())
    new_launches = dedupe_records(scanned, _load_existing_keys(data_dir, "launches", days_to_check))
    new_grads = dedupe_records(raw_grads, _load_existing_keys(data_dir, "graduations", days_to_check))

    if not new_launches and not new_grads and not raw_pool_inits and not raw_swaps and to_block == state["lastIndexedBlock"]:
        return {"committed": False}

    # The reorg-window overlap (REORG_WINDOW blocks re-scanned every run) is
    # safe for launches/graduations and the pool index because all three are
    # raw per-record partitions deduped on (txHash, logIndex). Swap volume is
    # folded straight into hour-bar aggregates with no such per-record key
    # kept on disk, so re-scanning that overlap would double-count a swap
    # already folded into a committed bar. Only swaps strictly past the
    # cursor this run started from are folded; a genuine reorg landing only
    # on a Swap inside that narrow (~5-minute) window is the one case this
    # does not correct, and it is not a real cost here because launches,
    # graduations and the pool index are all still fully reorg-safe.
    swap_min_block = None if backfilling_history or state.get("lastIndexedBlock") is None else state["lastIndexedBlock"]
    new_swaps = [s for s in raw_swaps if swap_min_block is None or s["block"] > swap_min_block]

    # The measurement instant: the chain time of the block the cursor lands
    # on, read from that block's header (METHOD.md "Freshness"). One extra
    # header per run, and it is what `crawledAt` publishes -- never the run's
    # wall clock, which runs ahead of the chain LEDGE has read and would
    # close every window over minutes that were never scanned. A backwards
    # backfill does not advance the cursor, so it does not move the instant.
    last_indexed_at = None
    if not backfilling_history:
        last_indexed_at = format_iso(_fetch_block_timestamps(rpc_client, [to_block])[to_block])

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

    # Pool index: raw per-pool records, deduped on (txHash, logIndex) like
    # launches/graduations. Orientation is decided against every launch
    # token LEDGE has ever recorded, same as orphan status above.
    existing_pool_index = _load_pool_index(data_dir)
    existing_pool_index_keys = {_record_key(r) for r in existing_pool_index}
    new_pool_index = [
        _shape_pool_index(d, known_launch_tokens)
        for d in raw_pool_inits
        if _record_key(d) not in existing_pool_index_keys
    ]
    pool_index_by_id = {r["pool"]: r for r in existing_pool_index}
    pool_index_by_id.update({r["pool"]: r for r in new_pool_index})
    new_pool_bars = build_pool_bars(new_swaps, pool_index_by_id, pair_tokens)

    # --- stage every output in memory ------------------------------------
    partition_writes, partition_deletes = plan_partition_writes(
        data_dir,
        today,
        {"launches": _group_by_day(enriched_launches), "graduations": _group_by_day(shaped_grads)},
    )
    pool_bar_writes, pool_bar_deletes = plan_pool_bar_writes(data_dir, today, _group_pool_bars_by_day(new_pool_bars))
    pool_index_write = plan_pool_index_write(data_dir, new_pool_index)
    partition_writes = partition_writes + pool_bar_writes + ([pool_index_write] if pool_index_write else [])
    partition_deletes = partition_deletes + pool_bar_deletes
    pair_tokens_payload = (json.dumps(pair_tokens, sort_keys=True, indent=2) + "\n").encode()

    new_state = dict(state)
    if backfilling_history:
        new_state["firstIndexedBlock"] = start_block
    else:
        new_state["lastIndexedBlock"] = to_block
        new_state["lastIndexedAt"] = last_indexed_at
        if new_state.get("firstIndexedBlock") is None:
            new_state["firstIndexedBlock"] = start_block
    # lastRunAt / lastSuccessAt stay wall-clock: they answer whether this run
    # knew it was behind (`stale`), and nothing else. The published instant
    # is lastIndexedAt.
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

    crawled_at = crawled_at_for(new_state, all_launches)
    # `samples=` is not optional here. recompute.py passes it, so a crawl that
    # omitted it wrote a number.json that recompute.py would not reproduce --
    # and the byte-for-byte gate then failed every scheduled run, which is
    # exactly what happened on 2026-09-08. There is one published file, so
    # there must be one way of building it; test_crawl_matches_recompute pins
    # the two writers together.
    number_payload = canonical_dumps(
        build_number(
            all_launches, all_grads, new_state, crawled_at,
            samples=load_samples(data_dir / "samples"),
        )
    ).encode()
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
