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
import sys
from pathlib import Path

if __package__ in (None, ""):
    # allows `python pipeline/recompute.py` (no PYTHONPATH) as used by the
    # workflows, while leaving package-context imports (pytest) untouched.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.canonical import canonical_dumps
from pipeline.stats import build_number

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


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


def resolve_pair_class(launch: dict, pair_tokens: dict) -> str:
    """pairClass is re-derived from pair-tokens.json at recompute time, so
    reclassifying a symbol changes number.json without touching the JSONL."""
    pair_token = launch["pairToken"]
    if pair_token == ZERO_ADDRESS:
        return "eth"
    entry = pair_tokens.get(pair_token)
    return entry.get("class", "other") if entry else "other"


def recompute(data_dir) -> dict:
    data_dir = Path(data_dir)
    state = json.loads((data_dir / "state.json").read_text())
    pair_tokens_path = data_dir / "pair-tokens.json"
    pair_tokens = json.loads(pair_tokens_path.read_text()) if pair_tokens_path.exists() else {}

    launches = load_partitions(data_dir / "launches")
    graduations = load_partitions(data_dir / "graduations")

    for launch in launches:
        launch["pairClass"] = resolve_pair_class(launch, pair_tokens)

    # Before the first successful crawl, lastSuccessAt is null (see
    # data/state.json's seed schema). build_number still needs a concrete
    # crawledAt to anchor the 24h window; the epoch is a deterministic,
    # reproducible placeholder that renders as "insufficient data"
    # everywhere rather than crashing.
    crawled_at = state.get("lastSuccessAt") or "1970-01-01T00:00:00Z"
    return build_number(launches, graduations, state, crawled_at)


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
