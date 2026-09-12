"""jsonl -> data/number.json, no network access. Binding rules:
ARCHITECTURE.md sections 4/5/6/8.

This module never imports pipeline.rpc and never opens a socket: it is the
reproducibility oracle, re-derivable by anyone from the committed JSONL
partitions and pair-tokens.json with no chain access at all.
"""
from __future__ import annotations

import argparse
import difflib
import gzip
import json
import re
import sys
from pathlib import Path

if __package__ in (None, ""):
    # allows `python pipeline/recompute.py` (no PYTHONPATH) as used by the
    # workflows, while leaving package-context imports (pytest) untouched.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.canonical import canonical_dumps
from pipeline.stats import build_number, format_iso

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# Before anything is indexed there is no block to take chain time from. The
# epoch is a deterministic, reproducible placeholder that renders as
# "not enough data" everywhere rather than crashing.
EPOCH_ISO = "1970-01-01T00:00:00Z"


def _read_jsonl(path: Path) -> list[dict]:
    opener = gzip.open if path.name.endswith(".gz") else open
    records = []
    with opener(path, "rt") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def load_partitions(dir_path: Path) -> list[dict]:
    """Read every .jsonl and .jsonl.gz partition in dir_path, oldest first."""
    dir_path = Path(dir_path)
    if not dir_path.exists():
        return []
    records = []
    for path in sorted(dir_path.iterdir()):
        if path.name.endswith(".jsonl") or path.name.endswith(".jsonl.gz"):
            records.extend(_read_jsonl(path))
    return records


def load_pool_index(data_dir: Path) -> list[dict]:
    """data/pools/index.jsonl (the forward crawl) and index-backfill.jsonl
    (the one-time probe), read as one and deduped -- one line per pons pool,
    not a dated partition -- read separately from the hour bars so it is
    never folded in as though it were one."""
    records: list[dict] = []
    seen: set = set()
    for name in ("index.jsonl", "index-backfill.jsonl"):
        path = Path(data_dir) / "pools" / name
        if not path.exists():
            continue
        for record in _read_jsonl(path):
            key = (record.get("txHash"), record.get("logIndex"))
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
    return records


def load_pool_bars(data_dir: Path) -> list[dict]:
    """Every dated data/pools/YYYY-MM-DD.jsonl(.gz) hour bar, oldest first
    -- like load_partitions, but skipping index.jsonl, which lives in the
    same directory and is not a bar partition."""
    pools_dir = Path(data_dir) / "pools"
    if not pools_dir.exists():
        return []
    records = []
    for path in sorted(pools_dir.iterdir()):
        # Only dated partitions are bars. index.jsonl, index-backfill.jsonl
        # and backfill.jsonl live in the same directory and are not: folding
        # a probe point in as an hour bar would be a silent, wrong number.
        if not POOL_BAR_NAME.match(path.name):
            continue
        records.extend(_read_jsonl(path))
    return records


def load_pool_backfill(data_dir: Path) -> list[dict]:
    """data/pools/backfill.jsonl -- one line per (pool, mark) the probe
    answered (pipeline/backfill_pools.py). Read separately and handed to
    the outcomes block as probe points, never as bars."""
    path = Path(data_dir) / "pools" / "backfill.jsonl"
    if not path.exists():
        return []
    return _read_jsonl(path)


DATE_SUFFIX = re.compile(r"-\d{4}-\d{2}-\d{2}$")
POOL_BAR_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}\.jsonl(\.gz)?$")


def sample_key(filename: str) -> str:
    """The name a sample is published under: its filename, without the date it
    was measured on and without the extension, in camelCase.

    `raised-nothing-2026-09-08.json` -> `raisedNothing`. The date stays in the
    filename because a sample is a dated reading and the next one of the same
    measurement is a new file beside it, never an overwrite; it stays out of
    the key because the key names the measurement, not the reading. The date
    is published inside the file as `measuredAt` either way, which is the copy
    every renderer reads.
    """
    stem = filename[: -len(".json")] if filename.endswith(".json") else filename
    stem = DATE_SUFFIX.sub("", stem)
    head, *rest = stem.split("-")
    return head + "".join(word[:1].upper() + word[1:] for word in rest)


def load_samples(dir_path) -> dict:
    """Every .json file in data/samples/, keyed by sample_key.

    A sample is a dated measurement with its own n, read from the chain once
    and not recomputable from the JSONL partitions -- so it is carried through
    verbatim rather than derived. An absent or empty directory is a legal
    state and yields {}: a file written before samples existed still parses,
    and a site reading one prints nothing rather than inventing a figure.
    """
    dir_path = Path(dir_path)
    if not dir_path.exists():
        return {}
    samples = {}
    for path in sorted(dir_path.iterdir()):
        if path.is_file() and path.name.endswith(".json"):
            samples[sample_key(path.name)] = json.loads(path.read_text())
    return samples


def resolve_pair_class(launch: dict, pair_tokens: dict) -> str:
    """pairClass is re-derived from pair-tokens.json at recompute time, so
    reclassifying a symbol changes number.json without touching the JSONL."""
    pair_token = launch["pairToken"]
    if pair_token == ZERO_ADDRESS:
        return "eth"
    entry = pair_tokens.get(pair_token)
    return entry.get("class", "other") if entry else "other"


def crawled_at_for(state: dict, launches: list) -> str:
    """The instant the whole site keys on: the chain time of the last block
    LEDGE indexed, as an ISO-8601 Z string.

    METHOD.md "Freshness": `crawledAt` is a block timestamp, never the wall
    clock of the run that wrote the file. A window closing at a wall clock
    reaches past the chain LEDGE has actually read -- minutes that hold no
    launches because they were never scanned -- and understates every
    denominator computed over it.

    `state.json` carries it as `lastIndexedAt`, written from the header of
    `lastIndexedBlock` by the crawl. A state file written before that field
    existed falls back to a second past the newest launch in the record: a
    block header too, and short of indexed chain time. `lastSuccessAt` is a
    wall clock and is never consulted here -- it answers whether the
    generating run knew it was behind (`stale`), and nothing else.
    """
    last_indexed_at = state.get("lastIndexedAt")
    if last_indexed_at:
        return last_indexed_at
    if launches:
        # One second past the newest launch, so the half-open window closes
        # after it rather than on it -- the same convention pipeline/vectors.py
        # uses to anchor a window on a finished record. The cursor is always
        # further on than the newest record's block, so this is still short of
        # indexed chain time.
        return format_iso(max(l["ts"] for l in launches) + 1)
    return EPOCH_ISO


def recompute(data_dir) -> dict:
    data_dir = Path(data_dir)
    state = json.loads((data_dir / "state.json").read_text())
    pair_tokens_path = data_dir / "pair-tokens.json"
    pair_tokens = json.loads(pair_tokens_path.read_text()) if pair_tokens_path.exists() else {}

    launches = load_partitions(data_dir / "launches")
    graduations = load_partitions(data_dir / "graduations")
    pool_index = load_pool_index(data_dir)
    pool_bars = load_pool_bars(data_dir)
    backfill_points = load_pool_backfill(data_dir)

    for launch in launches:
        launch["pairClass"] = resolve_pair_class(launch, pair_tokens)

    samples = load_samples(data_dir / "samples")

    return build_number(
        launches,
        graduations,
        state,
        crawled_at_for(state, launches),
        samples=samples,
        pool_index=pool_index,
        pool_bars=pool_bars,
        backfill_points=backfill_points,
        pair_tokens=pair_tokens,
    )


def _unified_diff(committed: str, recomputed: str) -> str:
    return "".join(
        difflib.unified_diff(
            committed.splitlines(keepends=True),
            recomputed.splitlines(keepends=True),
            fromfile="committed",
            tofile="recomputed",
        )
    )


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Recompute data/number.json from raw partitions.")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--out", default="data/number.json")
    parser.add_argument("--check", action="store_true", help="diff against --out, exit 1 on mismatch")
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir)
    out_path = Path(args.out)
    recomputed = canonical_dumps(recompute(data_dir))

    if args.check:
        if not out_path.exists():
            print(f"recompute --check: {out_path} does not exist", file=sys.stderr)
            return 1
        committed = out_path.read_text()
        if committed != recomputed:
            print("recompute --check: mismatch", file=sys.stderr)
            print(_unified_diff(committed, recomputed), file=sys.stderr)
            return 1
        return 0

    tmp_path = out_path.with_name(out_path.name + ".tmp")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path.write_text(recomputed)
    tmp_path.replace(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
