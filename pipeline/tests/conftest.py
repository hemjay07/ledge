"""
Shared fixtures for the LEDGE pipeline test suite.

Two fixture tiers:

1. `big_fixture` — derived from `fixture-backfill-20h.json` (the real 20-hour
   backfill capture referenced in ARCHITECTURE.md §13 / PONS_CONTRACTS.md).
   That raw file has block numbers only: no timestamps, no txHash/logIndex,
   no creatorTaxBps. ARCHITECTURE.md §13 is explicit that it "cannot seed a
   METHOD-compliant dataset" for production use, but is retained "for pytest
   fixtures for stats.py, with synthetic timestamps ... clearly marked as
   fixture-only". This conftest performs exactly that conversion:
     - ts is SYNTHETIC: ts = SYNTHETIC_EPOCH + block * SYNTHETIC_SECONDS_PER_BLOCK
       (documented here as fixture-only; production timestamps come from
       eth_getBlockByNumber headers per METHOD.md, never a block-count
       conversion)
     - txHash/logIndex are SYNTHETIC: deterministic sha256-derived hex,
       distinct per (token, launch|grad) so dedupe-key tests are meaningful
     - creatorTaxBps is None for every record: the raw fixture carries no
       tax data at all, so every launch in this fixture is, correctly,
       "missing enrichment" for the tax cohort
     - pairClass is derived deterministically: pairToken 0x0 -> "eth",
       anything else -> "other" (the raw fixture has no symbol() data to
       resolve stable/stock buckets; those buckets are covered by the
       hand-built small fixtures below instead)

   Known, doc-confirmed totals for this fixture (do not recompute a
   different number for these four — they are given facts, and tests should
   assert against them directly):
     - 23,552 launches
     - 559 graduation events
     - 535 matched (token has a launch in the fixture)
     - 24 orphan graduations (token has no launch in the fixture)

2. Small hand-built fixtures (10-40 records) built via `make_launch` /
   `make_grad` factories, for precise, engineered assertions (cohort n=29
   vs n=30 boundaries, exact percentile values, exact oneIn rounding, etc).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).parent
BACKFILL_FIXTURE_PATH = FIXTURE_DIR / "fixture-backfill-20h.json"

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# --- synthetic-conversion constants (fixture-only, see module docstring) ---
SYNTHETIC_EPOCH = 1757000000  # arbitrary fixed epoch (2026-09-04T13:33:20Z)
SYNTHETIC_SECONDS_PER_BLOCK = 0.099


def synthetic_ts(block: int) -> int:
    """Deterministic synthetic timestamp for a block number. TEST-FIXTURE ONLY."""
    return SYNTHETIC_EPOCH + int(round(block * SYNTHETIC_SECONDS_PER_BLOCK))


def synthetic_key(token: str, kind: str) -> tuple[str, int]:
    """Deterministic synthetic (txHash, logIndex) dedupe key. TEST-FIXTURE ONLY."""
    digest = hashlib.sha256(f"{kind}:{token}".encode()).hexdigest()
    return "0x" + digest, 0


@pytest.fixture(scope="session")
def raw_backfill() -> dict:
    with open(BACKFILL_FIXTURE_PATH) as f:
        return json.load(f)


def _pair_class(pair_token: str) -> str:
    return "eth" if pair_token == ZERO_ADDRESS else "other"


def _launch_record(token: str, info: dict) -> dict:
    tx_hash, log_index = synthetic_key(token, "launch")
    pair_token = info["pairToken"]
    return {
        "token": token,
        "curve": "0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
        "deployer": info["deployer"],
        "pairToken": pair_token,
        "pairClass": _pair_class(pair_token),
        "creatorTaxBps": None,
        "block": info["block"],
        "ts": synthetic_ts(info["block"]),
        "txHash": tx_hash,
        "logIndex": log_index,
    }


def _grad_record(token: str, info: dict, known_launch_tokens: dict) -> dict:
    tx_hash, log_index = synthetic_key(token, "grad")
    raw_amount = info["pairTokenAmount"]
    return {
        "token": token,
        "block": info["block"],
        "ts": synthetic_ts(info["block"]),
        "pairTokenAmount": str(int(round(raw_amount * 1e18))),
        "orphan": token not in known_launch_tokens,
        "txHash": tx_hash,
        "logIndex": log_index,
    }


@pytest.fixture(scope="session")
def big_fixture(raw_backfill):
    """(launches, graduations) lists derived from the 20h backfill.

    23,552 launches / 559 graduations / 535 matched / 24 orphans.
    """
    launches_by_token = raw_backfill["launches"]
    grads_by_token = raw_backfill["grads"]
    launches = [_launch_record(tok, info) for tok, info in launches_by_token.items()]
    graduations = [
        _grad_record(tok, info, launches_by_token) for tok, info in grads_by_token.items()
    ]
    launches.sort(key=lambda r: r["block"])
    graduations.sort(key=lambda r: r["block"])
    return launches, graduations


@pytest.fixture(scope="session")
def big_fixture_bounds(big_fixture):
    launches, _ = big_fixture
    ts_values = [r["ts"] for r in launches]
    return min(ts_values), max(ts_values)


# --- known, doc-confirmed totals (see PONS_CONTRACTS.md / ARCHITECTURE.md) --
KNOWN_LAUNCHES = 23552
KNOWN_GRADUATION_EVENTS = 559
KNOWN_MATCHED_GRADUATIONS = 535
KNOWN_ORPHAN_GRADUATIONS = 24
KNOWN_DISTINCT_DEPLOYERS = 15258
KNOWN_DEPLOYERS_2PLUS = 1806
KNOWN_LAUNCHES_FROM_10PLUS_DEPLOYERS = 5020


@pytest.fixture
def known_totals():
    return {
        "launches": KNOWN_LAUNCHES,
        "graduation_events": KNOWN_GRADUATION_EVENTS,
        "matched": KNOWN_MATCHED_GRADUATIONS,
        "orphans": KNOWN_ORPHAN_GRADUATIONS,
        "distinct_deployers": KNOWN_DISTINCT_DEPLOYERS,
        "deployers_2plus": KNOWN_DEPLOYERS_2PLUS,
        "launches_from_10plus_deployers": KNOWN_LAUNCHES_FROM_10PLUS_DEPLOYERS,
    }


# --- small hand-built record factories --------------------------------------
@pytest.fixture
def make_launch():
    counter = {"n": 0}

    def _make(
        token: str | None = None,
        deployer: str = "0xdeployer0000000000000000000000000000001",
        pair_token: str = ZERO_ADDRESS,
        pair_class: str = "eth",
        tax_bps: int | None = 0,
        block: int = 1_000_000,
        ts: int = 1_700_000_000,
        curve: str = "0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
    ) -> dict:
        counter["n"] += 1
        tok = token or f"0xtoken{counter['n']:036x}"
        tx_hash, log_index = synthetic_key(tok, f"launch-{counter['n']}")
        return {
            "token": tok,
            "curve": curve,
            "deployer": deployer,
            "pairToken": pair_token,
            "pairClass": pair_class,
            "creatorTaxBps": tax_bps,
            "block": block,
            "ts": ts,
            "txHash": tx_hash,
            "logIndex": log_index,
        }

    return _make


@pytest.fixture
def make_grad():
    counter = {"n": 0}

    def _make(
        token: str,
        block: int = 1_000_100,
        ts: int = 1_700_000_100,
        pair_token_amount: str = "1000000000000000000",
        orphan: bool = False,
        log_index: int = 0,
    ) -> dict:
        counter["n"] += 1
        tx_hash, _ = synthetic_key(token, f"grad-{counter['n']}")
        return {
            "token": token,
            "block": block,
            "ts": ts,
            "pairTokenAmount": pair_token_amount,
            "orphan": orphan,
            "txHash": tx_hash,
            "logIndex": log_index,
        }

    return _make
