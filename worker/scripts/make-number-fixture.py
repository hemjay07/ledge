#!/usr/bin/env python3
"""Regenerate worker/tests/fixtures/number.json through pipeline/recompute.py.

WHY THIS EXISTS. The Worker's frozen fixture used to be hand-assembled, and a
hand-assembled number.json can hold a state the pipeline could never emit. The
one that mattered: its ladder said 72 of 107 graduations completed inside
300 s while `fastShares.under300Share` said 0.71028 — 76 of the same 107. Two
published figures METHOD.md ("The ladder") says cannot disagree, because the
300 s rung IS the share that graduated inside five minutes. Every test written
against that fixture was asserting an impossible measurement.

So the fixture is no longer written. It is COMPUTED, by `pipeline/stats.py` —
the only place a statistic is defined — through `pipeline/recompute.py`,
exactly the path CI's byte-for-byte gate takes, over the real 20-hour capture
the pytest suite already uses (`pipeline/tests/fixture-backfill-20h.json`,
converted by the same rules as `pipeline/tests/conftest.py`). Monotone ladder,
rung 300 == under300Share × n, n-gated shares and half-open windows then hold
by construction rather than by inspection.

TWO FIELDS THE CAPTURE DOES NOT CARRY, and what is done about each:

  - `ts`. The capture has block numbers only. Timestamps are SYNTHETIC, by
    conftest.py's documented fixture-only conversion (epoch + block × 0.099).
    Production timestamps come from block headers and never from a
    blocks-per-second conversion (METHOD.md "Source").
  - `creatorTaxBps`. The capture carries no tax reading at all. Tax is
    assigned deterministically here, as `pipeline/vectors.py` does for the
    same reason, and the assignment is engineered so the Worker suite keeps
    the coverage it needs: exactly 29 launches in stable/2-3%, which pins the
    n = 30 gate from below, and roughly one launch in forty with no readable
    tax at all, which keeps `cohortsExcluded.tax` off zero.

Everything else — pair token, pair class, deployer, block, and every one of
the 535 matched times to graduation — is the real capture's.

    python3 worker/scripts/make-number-fixture.py

Reads pipeline/ and data/ (writes to neither) and rewrites exactly one file:
worker/tests/fixtures/number.json.
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKER = HERE.parent
REPO = WORKER.parent
sys.path.insert(0, str(REPO))

from pipeline.recompute import recompute  # noqa: E402

CAPTURE = REPO / "pipeline" / "tests" / "fixture-backfill-20h.json"
PAIR_TOKENS = WORKER / "tests" / "fixtures" / "pair-tokens.json"
OUT = WORKER / "tests" / "fixtures" / "number.json"

# conftest.py's fixture-only conversion, repeated rather than imported so this
# script does not depend on pytest being installed.
SYNTHETIC_EPOCH = 1757000000
SYNTHETIC_SECONDS_PER_BLOCK = 0.099
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# One bps inside each documented bucket (pipeline/stats.py `_tax_bucket`).
TAX_BPS = {"0%": 0, "1%": 100, "2-3%": 300, "4-5%": 500, "6-10%": 800}
STABLE_ROTATION = ["0%", "1%", "4-5%", "6-10%"]  # never 2-3%: that cell is pinned
FULL_ROTATION = ["0%", "1%", "2-3%", "4-5%", "6-10%"]

#: Launches placed in stable/2-3% and nowhere else. One below the n = 30 gate.
PINNED_STABLE_2_3 = 29
#: One launch in this many has no readable tax.
UNREADABLE_TAX_EVERY = 40


def synthetic_ts(block: int) -> int:
    return SYNTHETIC_EPOCH + int(round(block * SYNTHETIC_SECONDS_PER_BLOCK))


def synthetic_key(token: str, kind: str) -> tuple[str, int]:
    return "0x" + hashlib.sha256(f"{kind}:{token}".encode()).hexdigest(), 0


def pair_class_of(pair_token: str, pair_tokens: dict) -> str:
    if pair_token == ZERO_ADDRESS:
        return "eth"
    entry = pair_tokens.get(pair_token)
    return entry.get("class", "other") if entry else "other"


def build_records(capture: dict, pair_tokens: dict) -> tuple[list[dict], list[dict]]:
    launches_by_token = capture["launches"]
    grads_by_token = capture["grads"]

    ordered = sorted(launches_by_token.items(), key=lambda kv: (kv[1]["block"], kv[0]))
    stable_seen = 0
    rotation = 0
    launches = []
    for index, (token, info) in enumerate(ordered):
        pair_token = info["pairToken"]
        pair_class = pair_class_of(pair_token, pair_tokens)

        if index % UNREADABLE_TAX_EVERY == UNREADABLE_TAX_EVERY - 1:
            tax_bps = None
        elif pair_class == "stable":
            if stable_seen < PINNED_STABLE_2_3:
                tax_bps = TAX_BPS["2-3%"]
            else:
                tax_bps = TAX_BPS[STABLE_ROTATION[rotation % len(STABLE_ROTATION)]]
                rotation += 1
            stable_seen += 1
        else:
            tax_bps = TAX_BPS[FULL_ROTATION[rotation % len(FULL_ROTATION)]]
            rotation += 1

        tx_hash, log_index = synthetic_key(token, "launch")
        launches.append(
            {
                "token": token,
                "curve": "0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
                "deployer": info["deployer"],
                "pairToken": pair_token,
                "pairClass": pair_class,  # recompute.py re-derives this anyway
                "creatorTaxBps": tax_bps,
                "block": info["block"],
                "ts": synthetic_ts(info["block"]),
                "txHash": tx_hash,
                "logIndex": log_index,
            }
        )

    graduations = []
    for token, info in sorted(grads_by_token.items(), key=lambda kv: (kv[1]["block"], kv[0])):
        tx_hash, log_index = synthetic_key(token, "grad")
        graduations.append(
            {
                "token": token,
                "block": info["block"],
                "ts": synthetic_ts(info["block"]),
                "pairTokenAmount": str(int(round(info["pairTokenAmount"] * 1e18))),
                "orphan": token not in launches_by_token,
                "txHash": tx_hash,
                "logIndex": log_index,
            }
        )
    return launches, graduations


def write_data_dir(root: Path, launches: list, graduations: list, pair_tokens: dict, crawled_at: str) -> None:
    for name, records in (("launches", launches), ("graduations", graduations)):
        directory = root / name
        directory.mkdir(parents=True)
        by_day: dict[str, list] = {}
        for record in records:
            day = datetime.fromtimestamp(record["ts"], timezone.utc).strftime("%Y-%m-%d")
            by_day.setdefault(day, []).append(record)
        for day, rows in by_day.items():
            with open(directory / f"{day}.jsonl", "w") as f:
                for row in rows:
                    f.write(json.dumps(row, sort_keys=True) + "\n")

    (root / "pair-tokens.json").write_text(json.dumps(pair_tokens, indent=2, sort_keys=True))
    (root / "state.json").write_text(
        json.dumps(
            {
                "version": 1,
                "firstIndexedBlock": min(r["block"] for r in launches),
                "lastIndexedBlock": max(r["block"] for r in launches),
                "reorgWindow": 3000,
                "lastRunAt": crawled_at,
                "lastSuccessAt": crawled_at,
                "consecutiveFailures": 0,
                "lastError": None,
            },
            indent=2,
        )
    )


NOTE = (
    "Frozen fixture. Never live data. COMPUTED by pipeline/recompute.py — and "
    "so by pipeline/stats.py, the only place a statistic is defined — over the "
    "real 20-hour capture in pipeline/tests/fixture-backfill-20h.json, with "
    "fixture-only synthetic timestamps and creator-tax readings exactly as "
    "pipeline/tests/conftest.py documents. Regenerate with "
    "`python3 worker/scripts/make-number-fixture.py`. Never hand-edit a figure "
    "in it: a hand-edited one can hold a state the pipeline could not emit, "
    "which is how this file's ladder once disagreed with its own fastShares."
)


def main() -> int:
    capture = json.loads(CAPTURE.read_text())
    pair_tokens = json.loads(PAIR_TOKENS.read_text())
    launches, graduations = build_records(capture, pair_tokens)

    # The run's clock: one second past the newest launch in the capture, so
    # every launch falls inside the half-open window [crawledAt-86400,
    # crawledAt) and the 24-hour window covers the whole 20-hour record.
    crawled_at = datetime.fromtimestamp(
        max(r["ts"] for r in launches) + 1, timezone.utc
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "data"
        write_data_dir(root, launches, graduations, pair_tokens, crawled_at)
        number = recompute(root)

    number["_note"] = NOTE
    OUT.write_text(json.dumps(number, indent=2, sort_keys=True) + "\n")

    window = number["allTime"]
    print(f"wrote {OUT}")
    print(
        f"  crawledAt={number['crawledAt']} launches={window['launches']} "
        f"graduations={window['graduations']} orphans={window['orphans']}"
    )
    print(
        f"  ttg n={window['ttg']['n']} max={window['ttg']['max']} "
        f"under300Share={window['fastShares']['under300Share']}"
    )
    for row in window["cohorts"]["pairTax"]:
        print(f"    {row['bucket']:<16} n={row['launches']:<6} grads={row['graduations']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
