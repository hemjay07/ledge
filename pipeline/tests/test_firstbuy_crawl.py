"""
pipeline/crawl.py + pipeline/rpc.py — first-buy timing (FIRSTBUY-BRIEF.md,
2026-09-13).

Reuses the stub RPC from test_pools_crawl.py, extended there to serve
TOPIC_CURVE_BUY, and the same run_dir/_write_launch/_state/_now/_iso_ts
fixtures -- this file is a continuation of that one, not a new convention.

Binding rules exercised here:
  - CurveBuy is read with no address filter (rpc.get_logs(..., address=None)).
  - The launch-tx buy (same txHash as the launch) and the first outside buy
    (a different txHash, earliest by (block, logIndex)) are two separate
    records, `inLaunchTx` true/false.
  - No buyer address is ever written to a record (CONSTRAINTS.md #2) -- only
    `buyerIsDeployer`, a bool.
  - A launch whose block is before `state.firstBuyIndexedFromBlock` gets no
    record at all, and that threshold never moves once set.
  - Re-scanning the same buys (the reorg-window overlap) produces no
    duplicate records.
  - crawl.run() and recompute.recompute() agree byte for byte once firstbuys
    exist, the same pinning pattern as test_pools_crawl.py's own.
"""
import gzip
import json

import pytest

from pipeline import crawl
from pipeline.rpc import TOPIC_CURVE_BUY
from pipeline.tests.test_pools_crawl import (
    _PoolStubRpc,
    _iso_ts,
    _now,
    _write_launch,
    run_dir,  # noqa: F401 -- imported as a fixture
)

TOKEN = "0x" + "1" * 40
CURVE = "0x" + "c" * 40  # matches _write_launch's hardcoded curve
DEPLOYER = "0x" + "d" * 40  # matches _write_launch's hardcoded deployer
BUYER = "0x" + "b" * 40
LAUNCH_TX = "0x" + "90" * 32  # matches _write_launch's hardcoded txHash
OUTSIDE_TX = "0x" + "91" * 32


def _word(value: int) -> str:
    return format(value, "064x")


def _addr_topic(addr: str) -> str:
    return "0x" + addr[2:].rjust(64, "0")


def _buy_log(curve, buyer, block, tx_hash, log_index=0, recipient=None, quote_in=10**16, tokens_out=10**18, fee=0, tax=0):
    return {
        "address": curve,
        "topics": [TOPIC_CURVE_BUY, _addr_topic(buyer), _addr_topic(recipient or buyer)],
        "data": "0x" + _word(quote_in) + _word(tokens_out) + _word(fee) + _word(tax),
        "blockNumber": hex(block),
        "transactionHash": tx_hash,
        "logIndex": hex(log_index),
    }


def _read_firstbuys(run_dir):
    day_dir = run_dir / "firstbuys"
    if not day_dir.exists():
        return []
    records = []
    for path in sorted(day_dir.iterdir()):
        opener = gzip.open if path.name.endswith(".gz") else open
        with opener(path, "rt") as f:
            records.extend(json.loads(line) for line in f if line.strip())
    return records


def _raw_firstbuys_text(run_dir):
    day_dir = run_dir / "firstbuys"
    text = ""
    if not day_dir.exists():
        return text
    for path in sorted(day_dir.iterdir()):
        if path.name.endswith(".gz"):
            with gzip.open(path, "rt") as f:
                text += f.read()
        else:
            text += path.read_text()
    return text


# --- launch-tx buy + first outside buy -> two records ------------------------
def test_launch_tx_buy_and_outside_buy_produce_two_records(run_dir, monkeypatch):
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    _write_launch(run_dir, TOKEN, block=1400)
    launch_tx_buy = _buy_log(CURVE, BUYER, block=1400, tx_hash=LAUNCH_TX, log_index=1)
    outside_buy = _buy_log(CURVE, BUYER, block=1450, tx_hash=OUTSIDE_TX, log_index=0)
    rpc_client = _PoolStubRpc(
        buy_logs=[launch_tx_buy, outside_buy],
        timestamps={1400: _iso_ts("2026-09-11"), 1450: _iso_ts("2026-09-11") + 20},
    )

    crawl.run(data_dir=run_dir, rpc_client=rpc_client, head_block=1600, now=_now(day="2026-09-11"))

    records = _read_firstbuys(run_dir)
    assert len(records) == 2
    by_flag = {r["inLaunchTx"]: r for r in records}
    assert by_flag[True]["txHash"] == LAUNCH_TX
    assert by_flag[True]["buyerIsDeployer"] is False
    assert by_flag[False]["txHash"] == OUTSIDE_TX
    assert by_flag[False]["buyerIsDeployer"] is False
    assert by_flag[False]["block"] == 1450

    # CONSTRAINTS.md #2: no wallet address is ever written to a record.
    raw_text = _raw_firstbuys_text(run_dir)
    assert BUYER not in raw_text


def test_first_buy_indexed_from_block_is_set_from_this_runs_start_block(run_dir, monkeypatch):
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    state_before = json.loads((run_dir / "state.json").read_text())
    assert "firstBuyIndexedFromBlock" not in state_before
    expected_start_block = crawl.resume_start_block(state_before)

    crawl.run(data_dir=run_dir, rpc_client=_PoolStubRpc(), head_block=1600, now=_now(day="2026-09-11"))

    state_after = json.loads((run_dir / "state.json").read_text())
    assert state_after["firstBuyIndexedFromBlock"] == expected_start_block


# --- re-seeing the same buys produces no duplicate --------------------------
def test_a_second_run_reseeing_the_same_buys_does_not_duplicate(run_dir, monkeypatch):
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    _write_launch(run_dir, TOKEN, block=1400)
    launch_tx_buy = _buy_log(CURVE, BUYER, block=1400, tx_hash=LAUNCH_TX, log_index=1)
    outside_buy = _buy_log(CURVE, BUYER, block=1450, tx_hash=OUTSIDE_TX, log_index=0)
    timestamps = {1400: _iso_ts("2026-09-11"), 1450: _iso_ts("2026-09-11") + 20}

    crawl.run(
        data_dir=run_dir,
        rpc_client=_PoolStubRpc(buy_logs=[launch_tx_buy, outside_buy], timestamps=timestamps),
        head_block=1600,
        now=_now(day="2026-09-11"),
    )
    assert len(_read_firstbuys(run_dir)) == 2

    crawl.run(
        data_dir=run_dir,
        rpc_client=_PoolStubRpc(buy_logs=[launch_tx_buy, outside_buy], timestamps=timestamps),
        head_block=1600,
        now=_now(day="2026-09-11"),
    )

    assert len(_read_firstbuys(run_dir)) == 2


# --- a launch before the threshold gets no record ----------------------------
def test_launch_before_first_buy_indexed_from_block_gets_no_record(run_dir, monkeypatch):
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    state = json.loads((run_dir / "state.json").read_text())
    state["firstBuyIndexedFromBlock"] = 1300
    (run_dir / "state.json").write_text(json.dumps(state))

    _write_launch(run_dir, TOKEN, block=1200)
    buy = _buy_log(CURVE, BUYER, block=1200, tx_hash=LAUNCH_TX, log_index=1)
    rpc_client = _PoolStubRpc(buy_logs=[buy], timestamps={1200: _iso_ts("2026-09-11")})

    crawl.run(data_dir=run_dir, rpc_client=rpc_client, head_block=1600, now=_now(day="2026-09-11"))

    assert _read_firstbuys(run_dir) == []
    after = json.loads((run_dir / "state.json").read_text())
    assert after["firstBuyIndexedFromBlock"] == 1300  # never moved


# --- the two writers of number.json must agree once firstbuys exist ---------
def test_crawl_writes_the_same_number_file_recompute_would_with_firstbuys(run_dir, monkeypatch):
    from pipeline import recompute as recompute_mod
    from pipeline.canonical import canonical_dumps

    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    _write_launch(run_dir, TOKEN, block=1400)
    launch_tx_buy = _buy_log(CURVE, BUYER, block=1400, tx_hash=LAUNCH_TX, log_index=1)
    outside_buy = _buy_log(CURVE, BUYER, block=1450, tx_hash=OUTSIDE_TX, log_index=0)
    rpc_client = _PoolStubRpc(
        buy_logs=[launch_tx_buy, outside_buy],
        timestamps={1400: _iso_ts("2026-09-11"), 1450: _iso_ts("2026-09-11") + 20},
    )

    crawl.run(data_dir=run_dir, rpc_client=rpc_client, head_block=1600, now=_now(day="2026-09-11"))

    assert _read_firstbuys(run_dir), "the firstbuy records were not recorded; the test would prove nothing"
    written = (run_dir / "number.json").read_text()
    expected = canonical_dumps(recompute_mod.recompute(run_dir))
    assert written == expected
