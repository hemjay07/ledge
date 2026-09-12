"""
pipeline/backfill_pools.py -- OUTCOMES-BACKFILL-BRIEF.md, and the
`fromProbe` / bar-over-probe additions to pipeline/stats.py's `outcomes`
block that make a probe reading visible and never let it override a real
hour bar.

Binding rules exercised here:
  - A mark that has not elapsed by state.json's own `lastIndexedAt` is
    skipped entirely -- never written, never `noTrade`.
  - Swap probing widens 500 -> 3,000 -> 15,000 blocks only while the
    window is empty; the FIRST non-empty width wins and stops the widen.
  - Within a window, the LAST swap (highest block, then highest logIndex)
    is priced, never the first.
  - All three widths empty writes `noTrade: true` at windowBlocks=15000,
    never left unwritten.
  - A per-item RPC failure (no result for that one request) is retried at
    the SAME width and never mistaken for an empty window.
  - A rerun re-probes nothing already in data/pools/backfill.jsonl.
  - pipeline.stats.outcomes: a mark answered by a probe counts toward `n`
    and is reported in `fromProbe`; a real hour bar always wins over a
    probe for the same mark.

Offline throughout: a stub `rpc_client` (get_logs / call_batch), no real
RpcClient, no network -- same convention as test_pools_crawl.py.
"""
import json

import pytest

from pipeline import backfill_pools
from pipeline.stats import OUTCOME_MARKS, outcomes
from pipeline.tests.test_outcomes_stats import (
    UNTIL_FAR_FUTURE,
    _bar,
    _grad,
    _launch,
    _pair_row,
    _pool_index_row,
    _pool_id,
    _token,
)
from pipeline.tests.test_pool import _make_swap_log

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
TOKEN = "0x1111111111111111111111111111111111111111"  # > ZERO_ADDRESS: currency1
POOL_ID = "0x" + "ab" * 32
POOL_BLOCK = 1000
AVG_BLOCK_SECONDS = backfill_pools.AVG_BLOCK_SECONDS


def _mark_block(seconds: int) -> int:
    return POOL_BLOCK + round(seconds / AVG_BLOCK_SECONDS)


class _StubRpc:
    """Duck-types the two methods backfill_pools.run needs, exactly like
    test_pools_crawl.py's own stub -- no real RpcClient, no raw JSON-RPC
    envelope. `fail_first_n` per-item eth_getLogs calls come back with no
    result (None) before the real answer, simulating a busy endpoint."""

    def __init__(self, init_logs=(), swap_logs=(), timestamps=None, fail_first_n=0):
        self.init_logs = list(init_logs)
        self.swap_logs = list(swap_logs)
        self.timestamps = dict(timestamps or {})
        self.fail_first_n = fail_first_n
        self.swap_requests = []  # (from_block, to_block) for every eth_getLogs call issued

    def get_logs(self, from_block, to_block, topic0, address=None, topic1=None):
        assert topic0 == backfill_pools.TOPIC_V4_INITIALIZE
        return [l for l in self.init_logs if from_block <= int(l["blockNumber"], 16) <= to_block]

    def call_batch(self, requests):
        results = []
        for request in requests:
            if request["method"] == "eth_getBlockByNumber":
                block = int(request["params"][0], 16)
                results.append({"timestamp": hex(self.timestamps.get(block, 0))})
                continue
            assert request["method"] == "eth_getLogs"
            params = request["params"][0]
            from_block = int(params["fromBlock"], 16)
            to_block = int(params["toBlock"], 16)
            pool_ids = set(params["topics"][1])
            self.swap_requests.append((from_block, to_block))
            if self.fail_first_n > 0:
                self.fail_first_n -= 1
                results.append(None)
                continue
            matches = [
                l
                for l in self.swap_logs
                if l["topics"][1] in pool_ids and from_block <= int(l["blockNumber"], 16) <= to_block
            ]
            results.append(matches)
        return results


def _state(**overrides):
    state = {
        "version": 1,
        "firstIndexedBlock": 0,
        "lastIndexedBlock": 2_000_000,
        "lastIndexedAt": "1970-01-01T02:00:00Z",  # ts=7200: 1h elapsed, 24h/7d not
        "reorgWindow": 3000,
        "lastRunAt": "2026-01-01T00:00:00Z",
        "lastSuccessAt": "2026-01-01T00:00:00Z",
        "consecutiveFailures": 0,
        "lastError": None,
        "counts": {"launches": 0, "graduations": 0, "orphanGraduations": 0, "enrichmentFailures": 0},
    }
    state.update(overrides)
    return state


def _write_run_dir(tmp_path, state, pool_record, graduation):
    (tmp_path / "state.json").write_text(json.dumps(state))
    pools_dir = tmp_path / "pools"
    pools_dir.mkdir()
    (pools_dir / "index.jsonl").write_text(json.dumps(pool_record) + "\n")
    grads_dir = tmp_path / "graduations"
    grads_dir.mkdir()
    (grads_dir / "2026-01-01.jsonl").write_text(json.dumps(graduation) + "\n")
    return tmp_path


def _pool_record(pool_id=POOL_ID, token=TOKEN, pair=ZERO_ADDRESS, block=POOL_BLOCK, ts=0):
    return {
        "pool": pool_id,
        "token": token,
        "pair": pair,
        "block": block,
        "ts": ts,
        "sqrtPriceX96": 2**96,
        "tickSpacing": 60,
        "txHash": "0x" + "cc" * 32,
        "logIndex": 0,
    }


def _read_backfill(run_dir):
    path = run_dir / "pools" / "backfill.jsonl"
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(backfill_pools.time, "sleep", lambda *_: None)


# --- unelapsed marks ---------------------------------------------------------
def test_unelapsed_mark_is_not_written_at_all(tmp_path):
    state = _state(lastIndexedAt="1970-01-01T02:00:00Z")  # ts=7200: only 1h has elapsed
    run_dir = _write_run_dir(tmp_path, state, _pool_record(), {"token": TOKEN, "block": POOL_BLOCK, "ts": 0})
    rpc_client = _StubRpc()

    backfill_pools.run(run_dir, rpc_client)

    marks_written = {p["mark"] for p in _read_backfill(run_dir)}
    assert marks_written == {"1h"}  # 24h and 7d have not elapsed and are absent, not noTrade


# --- widening ----------------------------------------------------------------
def test_empty_window_widens_before_writing_no_trade(tmp_path):
    state = _state(lastIndexedAt="1970-01-01T02:00:00Z")
    run_dir = _write_run_dir(tmp_path, state, _pool_record(), {"token": TOKEN, "block": POOL_BLOCK, "ts": 0})
    rpc_client = _StubRpc(swap_logs=[])  # no swaps anywhere

    backfill_pools.run(run_dir, rpc_client)

    points = _read_backfill(run_dir)
    assert len(points) == 1
    point = points[0]
    assert point["mark"] == "1h"
    assert point["noTrade"] is True
    assert point["price"] is None
    assert point["readAtBlock"] is None
    assert point["windowBlocks"] == 15000  # the widest width tried

    mark_block = _mark_block(OUTCOME_MARKS["1h"])
    widths_tried = [to - frm + 1 for frm, to in rpc_client.swap_requests]
    assert widths_tried == [500, 3000, 15000]
    assert rpc_client.swap_requests[-1] == (mark_block - 15000 + 1, mark_block)


# --- last swap, not first ------------------------------------------------
def test_last_swap_in_window_is_taken_not_first(tmp_path):
    state = _state(lastIndexedAt="1970-01-01T02:00:00Z")
    run_dir = _write_run_dir(tmp_path, state, _pool_record(), {"token": TOKEN, "block": POOL_BLOCK, "ts": 0})
    mark_block = _mark_block(OUTCOME_MARKS["1h"])
    earlier = _make_swap_log(pool_id=POOL_ID, sqrt_price_x96=2**96, block=mark_block - 200, log_index=0)
    later = _make_swap_log(pool_id=POOL_ID, sqrt_price_x96=2 * 2**96, block=mark_block - 10, log_index=0)
    rpc_client = _StubRpc(swap_logs=[earlier, later])

    backfill_pools.run(run_dir, rpc_client)

    point = _read_backfill(run_dir)[0]
    assert point["noTrade"] is False
    assert point["readAtBlock"] == mark_block - 10  # the later swap, not the earlier one
    from pipeline.pool import quote_per_token

    expected = quote_per_token(2 * 2**96, ZERO_ADDRESS, TOKEN, TOKEN, 18, 18)
    assert point["price"] == format(expected, "f")


# --- resumability --------------------------------------------------------
def test_rerun_re_probes_nothing_already_in_backfill(tmp_path):
    state = _state(lastIndexedAt="1970-01-01T02:00:00Z")
    run_dir = _write_run_dir(tmp_path, state, _pool_record(), {"token": TOKEN, "block": POOL_BLOCK, "ts": 0})
    rpc_client = _StubRpc(swap_logs=[])

    backfill_pools.run(run_dir, rpc_client)
    first_points = _read_backfill(run_dir)
    requests_after_first_run = len(rpc_client.swap_requests)
    assert first_points  # sanity: something was written

    backfill_pools.run(run_dir, rpc_client)
    second_points = _read_backfill(run_dir)

    assert second_points == first_points  # unchanged
    assert len(rpc_client.swap_requests) == requests_after_first_run  # no new eth_getLogs calls issued


# --- busy endpoint retries, never silence ---------------------------------
def test_busy_endpoint_retries_and_never_writes_no_trade(tmp_path):
    state = _state(lastIndexedAt="1970-01-01T02:00:00Z")
    run_dir = _write_run_dir(tmp_path, state, _pool_record(), {"token": TOKEN, "block": POOL_BLOCK, "ts": 0})
    mark_block = _mark_block(OUTCOME_MARKS["1h"])
    swap = _make_swap_log(pool_id=POOL_ID, sqrt_price_x96=2**96, block=mark_block - 10, log_index=0)
    # The first two attempts at width=500 come back with no result at all
    # (a busy endpoint); the third succeeds and must be read as the answer.
    rpc_client = _StubRpc(swap_logs=[swap], fail_first_n=2)

    backfill_pools.run(run_dir, rpc_client)

    point = _read_backfill(run_dir)[0]
    assert point["noTrade"] is False
    assert point["readAtBlock"] == mark_block - 10
    # all three attempts were at the same (width=500) range -- never widened
    # past it just because the first two attempts errored
    assert rpc_client.swap_requests == [rpc_client.swap_requests[0]] * 3


# --- data/ isolation -------------------------------------------------------
def test_never_touches_state_or_other_partitions(tmp_path):
    state = _state(lastIndexedAt="1970-01-01T02:00:00Z")
    run_dir = _write_run_dir(tmp_path, state, _pool_record(), {"token": TOKEN, "block": POOL_BLOCK, "ts": 0})
    before_state = (run_dir / "state.json").read_text()
    rpc_client = _StubRpc(swap_logs=[])

    backfill_pools.run(run_dir, rpc_client)

    assert (run_dir / "state.json").read_text() == before_state
    assert not (run_dir / "number.json").exists()
    assert not list((run_dir / "pools").glob("*.jsonl")) == []  # backfill.jsonl + index.jsonl only
    assert not any(p.name not in ("index.jsonl", "backfill.jsonl") for p in (run_dir / "pools").glob("*.jsonl"))


# --- pipeline.stats.outcomes: fromProbe and bar-over-probe -----------------
def test_stats_counts_a_probe_reading_in_n_and_reports_from_probe():
    launches = [_launch(0)]
    grads = [_grad(0)]
    pool_index = [_pool_index_row(0)]
    backfill_points = [
        {
            "pool": _pool_id(0),
            "token": _token(0),
            "mark": "1h",
            "markBlock": 100,
            "markTs": 3600,
            "price": "1.5",
            "noTrade": False,
            "readAtBlock": 100,
            "windowBlocks": 500,
            "source": "backfill-probe",
        }
    ]

    result = outcomes(launches, grads, pool_index, [], {}, UNTIL_FAR_FUTURE, backfill_points)

    mark = _pair_row(result)["marks"]["1h"]
    assert mark["n"] == 1
    assert mark["fromProbe"] == 1  # published regardless of n < MIN_N, like n and noTrade


def test_real_bar_wins_over_probe_for_the_same_mark():
    # n=30 to clear MIN_N so the median is a real (non-null) value: a bar
    # exists for every one of these graduations, each with an equally
    # priced probe point that would give a very different changeAt (8.0
    # instead of 2.0) if the probe were ever allowed to answer a mark a
    # real bar already answers.
    n = 30
    launches = [_launch(i) for i in range(n)]
    grads = [_grad(i) for i in range(n)]
    pool_index = [_pool_index_row(i) for i in range(n)]
    bars = [_bar(i, hour="1970-01-01T01", close="3.0") for i in range(n)]  # opening 1.0 -> changeAt 2.0
    backfill_points = [
        {
            "pool": _pool_id(i),
            "token": _token(i),
            "mark": "1h",
            "markBlock": 100,
            "markTs": 3600,
            "price": "9.0",  # would give changeAt 8.0 -- must be ignored
            "noTrade": False,
            "readAtBlock": 100,
            "windowBlocks": 500,
            "source": "backfill-probe",
        }
        for i in range(n)
    ]

    result = outcomes(launches, grads, pool_index, bars, {}, UNTIL_FAR_FUTURE, backfill_points)

    mark = _pair_row(result)["marks"]["1h"]
    assert mark["n"] == n
    assert mark["fromProbe"] == 0
    assert mark["median"] == pytest.approx(2.0)
