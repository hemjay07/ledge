"""Generate the frozen dispatch fixture. Run once; the output is committed.

    python pipeline/tests/make_dispatch_fixture.py

The fixture is a complete, self-consistent data directory in the shape of
`data/` -- state.json, pair-tokens.json, daily launch and graduation
partitions, and the number.json that `pipeline/recompute.py` derives from
them. It exists so `pipeline/tests/test_dispatch.py` can assert on exact
sentences without reading live data: a crawl must never move a test.

Everything here is SYNTHETIC and fixture-only, in the same spirit as
`conftest.py`'s block-count timestamps: addresses, timestamps, tax readings
and graduation delays are derived deterministically from sha256 of the
record index. No value in this directory was measured on any chain and
none of it is ever published.

Shape of the sample, chosen so the dispatch's every branch has something to
render:

  - 1,400 launches on a fixed 432-second cadence across exactly 7 days,
    the first landing on the window's `since` boundary so the half-open
    interval is exercised;
  - 40 launches in the preceding day, so the 7-day window has something to
    exclude and the exclusion is visible in the counts;
  - graduation decided by a per-launch sha256 draw against a threshold that
    differs by pair class and by tax bucket, so both cohorts hold a real
    spread and "the two furthest apart" is a meaningful selection rather
    than a tie broken by ordering;
  - graduation delays drawn from a fixed table weighted toward the fast end,
    matching the shape METHOD.md records, so the ladder's 60-second rung and
    the p50/p90 percentiles are both populated;
  - one orphan graduation, for a token with no launch in the record.
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if __package__ in (None, ""):
    sys.path.insert(0, str(REPO_ROOT))

from pipeline.canonical import canonical_dumps
from pipeline.recompute import recompute

OUT_DIR = Path(__file__).resolve().parent / "fixtures" / "dispatch"

DAY = 86400
WINDOW_SECONDS = 7 * DAY

# The measurement instant. Fixed, so every rendered stamp in the tests is a
# constant.  2026-09-06T00:00:00Z.
UNTIL = 1788652800
SINCE = UNTIL - WINDOW_SECONDS

LAUNCH_COUNT = 1400
CADENCE = WINDOW_SECONDS // LAUNCH_COUNT  # 432 s
BEFORE_WINDOW_COUNT = 40

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# Four pair tokens, one per published class.
PAIR_TOKENS = {
    "eth": (ZERO_ADDRESS, "ETH"),
    "stable": ("0x1111111111111111111111111111111111111111", "USDC"),
    "stock": ("0x2222222222222222222222222222222222222222", "TSLA"),
    "other": ("0x3333333333333333333333333333333333333333", "WIF"),
}
PAIR_ORDER = ["eth", "stable", "stock", "other"]

# Tax readings in basis points, one per published bucket.
TAX_BPS = [0, 100, 200, 400, 600]

# Graduation likelihood per 1,000 draws, split into a pair-class part and a
# tax part so both cohorts hold a spread. These are fixture dials, not
# findings: nothing about the real chain is claimed by them.
PAIR_WEIGHT = {"eth": 10, "stable": 90, "stock": 40, "other": 5}
TAX_WEIGHT = {0: 60, 100: 40, 200: 25, 400: 10, 600: 0}

# Graduation delays in seconds, weighted toward the fast end the way the
# measured distribution is. Drawn uniformly by sha256, so the shares are a
# property of this table.
TTG_CHOICES = [
    5, 9, 14, 22, 31, 45, 58, 77, 96, 140,
    210, 290, 340, 520, 800, 1500, 2600, 4100, 7000, 12000,
]

FIRST_BLOCK = 40_000_000


def _draw(tag: str, index: int) -> int:
    return int(hashlib.sha256(f"{tag}:{index}".encode()).hexdigest()[:8], 16)


def _address(tag: str, index: int) -> str:
    return "0x" + hashlib.sha256(f"{tag}:{index}".encode()).hexdigest()[:40]


def _tx_hash(tag: str, index: int) -> str:
    return "0x" + hashlib.sha256(f"tx:{tag}:{index}".encode()).hexdigest()


def _launch(index: int, ts: int) -> dict:
    pair_class = PAIR_ORDER[index % len(PAIR_ORDER)]
    pair_token, _symbol = PAIR_TOKENS[pair_class]
    tax_bps = TAX_BPS[(index // len(PAIR_ORDER)) % len(TAX_BPS)]
    return {
        "token": _address("token", index),
        "curve": _address("curve", index),
        # 200 deployers, so the deployer distribution is not degenerate.
        "deployer": _address("deployer", index % 200),
        "pairToken": pair_token,
        "pairClass": pair_class,
        "creatorTaxBps": tax_bps,
        "block": FIRST_BLOCK + index * 10,
        "ts": ts,
        "txHash": _tx_hash("launch", index),
        "logIndex": index % 8,
    }


def _graduates(index: int, launch: dict) -> bool:
    threshold = PAIR_WEIGHT[launch["pairClass"]] + TAX_WEIGHT[launch["creatorTaxBps"]]
    return _draw("grad", index) % 1000 < threshold


def _delay(index: int) -> int:
    return TTG_CHOICES[_draw("delay", index) % len(TTG_CHOICES)]


def _grad_record(index: int, launch: dict, ts: int, orphan: bool = False) -> dict:
    return {
        "token": launch["token"],
        "block": FIRST_BLOCK + index * 10 + 5,
        "ts": ts,
        "pairTokenAmount": str(4_200_000_000_000_000_000 + index),
        "orphan": orphan,
        "txHash": _tx_hash("grad", index),
        "logIndex": index % 8,
    }


def build_records() -> tuple[list[dict], list[dict]]:
    launches: list[dict] = []
    graduations: list[dict] = []

    # The day before the window: present in the partitions, outside the
    # 7-day selection, so the dispatch's denominator is visibly narrower
    # than the file's row count.
    for i in range(BEFORE_WINDOW_COUNT):
        ts = SINCE - DAY + i * 900
        launches.append(_launch(10_000 + i, ts))

    for i in range(LAUNCH_COUNT):
        ts = SINCE + i * CADENCE
        launch = _launch(i, ts)
        launches.append(launch)
        if not _graduates(i, launch):
            continue
        grad_ts = ts + _delay(i)
        # A graduation the crawl has not reached yet is not in the file.
        # Truncating here is what makes the window a lower bound, which is
        # the property METHOD.md publishes.
        if grad_ts >= UNTIL:
            continue
        graduations.append(_grad_record(i, launch, grad_ts))

    # One graduation for a token that never launched in this record: it is
    # kept in the raw data and excluded from every rate.
    orphan_launch = _launch(99_999, SINCE)
    graduations.append(
        _grad_record(99_999, orphan_launch, SINCE + 2 * DAY, orphan=True)
    )

    launches.sort(key=lambda r: (r["ts"], r["token"]))
    graduations.sort(key=lambda r: (r["ts"], r["token"]))
    return launches, graduations


def _partition_name(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def _write_partitions(dir_path: Path, records: list[dict]) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)
    by_day: dict[str, list[dict]] = {}
    for record in records:
        by_day.setdefault(_partition_name(record["ts"]), []).append(record)
    for day, rows in sorted(by_day.items()):
        text = "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows)
        (dir_path / f"{day}.jsonl").write_text(text)


def main() -> int:
    launches, graduations = build_records()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    _write_partitions(OUT_DIR / "launches", launches)
    _write_partitions(OUT_DIR / "graduations", graduations)

    pair_tokens = {
        address: {"class": pair_class, "symbol": symbol}
        for pair_class, (address, symbol) in PAIR_TOKENS.items()
    }
    (OUT_DIR / "pair-tokens.json").write_text(canonical_dumps(pair_tokens))

    crawled_at = datetime.fromtimestamp(UNTIL, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    state = {
        "consecutiveFailures": 0,
        "counts": {
            "enrichmentFailures": 0,
            "graduations": len(graduations),
            "launches": len(launches),
            "orphanGraduations": 1,
        },
        "firstIndexedBlock": min(r["block"] for r in launches),
        "lastError": None,
        "lastIndexedBlock": max(r["block"] for r in launches),
        "lastRunAt": crawled_at,
        "lastSuccessAt": crawled_at,
        "reorgWindow": 3000,
        "version": 1,
    }
    (OUT_DIR / "state.json").write_text(canonical_dumps(state))

    # Derived by the same code path that derives data/number.json, so the
    # fixture cannot hold a figure the pipeline would not produce.
    (OUT_DIR / "number.json").write_text(canonical_dumps(recompute(OUT_DIR)))

    print(f"wrote {OUT_DIR}: {len(launches)} launches, {len(graduations)} graduations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
