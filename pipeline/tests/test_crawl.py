"""
pipeline/crawl.py — window planning, resume, dedupe, all-or-nothing commit.

Binding rules (ARCHITECTURE.md §4):
  - REORG_WINDOW = 3000 blocks.
  - Resume start = max(firstIndexedBlock, lastIndexedBlock - REORG_WINDOW + 1).
  - Scan to head in <= 1,000-block windows.
  - Dedupe key is (txHash, logIndex) ONLY -- never token address -- because a
    reorg replay produces identical keys and must collapse to one record.
  - Commit point: only after every stage succeeds are files written
    (partitions, pair-tokens.json, number.json, state.json). Any earlier
    failure writes NOTHING; state is unchanged; next run re-scans the same
    range.
  - Two consecutive empty runs (no new records, lastIndexedBlock unchanged)
    produce no commit / no file writes.
"""
import gzip
import json

import pytest

from pipeline import crawl


def _state(first=55_219_400, last=55_919_382):
    return {
        "version": 1,
        "firstIndexedBlock": first,
        "lastIndexedBlock": last,
        "reorgWindow": 3000,
        "lastRunAt": "2026-09-06T12:45:03Z",
        "lastSuccessAt": "2026-09-06T12:45:03Z",
        "consecutiveFailures": 0,
        "lastError": None,
        "counts": {"launches": 0, "graduations": 0, "orphanGraduations": 0, "enrichmentFailures": 0},
    }


# --- resume / window planning ------------------------------------------------
def test_resume_start_block_backs_up_by_reorg_window(monkeypatch):
    state = _state(first=1_000_000, last=1_100_000)
    start = crawl.resume_start_block(state)
    assert start == 1_100_000 - crawl.REORG_WINDOW + 1


def test_resume_start_block_never_goes_before_first_indexed_block():
    # lastIndexedBlock is close to firstIndexedBlock, so backing up by
    # REORG_WINDOW would go before the very first block LEDGE ever indexed.
    state = _state(first=1_000_000, last=1_000_500)
    start = crawl.resume_start_block(state)
    assert start == 1_000_000
    assert start >= state["firstIndexedBlock"]


def test_reorg_window_constant_is_3000():
    assert crawl.REORG_WINDOW == 3000


def test_plan_windows_never_exceeds_1000_blocks():
    windows = crawl.plan_windows(start_block=55_919_000, head_block=55_925_437)
    for frm, to in windows:
        assert to - frm + 1 <= 1000


def test_plan_windows_covers_full_range_contiguously():
    windows = crawl.plan_windows(start_block=1000, head_block=3500)
    assert windows[0][0] == 1000
    assert windows[-1][1] == 3500
    for (frm1, to1), (frm2, to2) in zip(windows, windows[1:]):
        assert frm2 == to1 + 1


def test_plan_windows_single_window_when_range_is_small():
    windows = crawl.plan_windows(start_block=1000, head_block=1500)
    assert windows == [(1000, 1500)]


def test_plan_windows_empty_when_start_after_head():
    windows = crawl.plan_windows(start_block=2000, head_block=1000)
    assert windows == []


# --- dedupe on (txHash, logIndex) --------------------------------------------
def test_dedupe_drops_records_matching_existing_key():
    existing = {("0xabc", 3)}
    records = [
        {"txHash": "0xabc", "logIndex": 3, "token": "0x1"},
        {"txHash": "0xdef", "logIndex": 0, "token": "0x2"},
    ]
    result = crawl.dedupe_records(records, existing)
    assert len(result) == 1
    assert result[0]["token"] == "0x2"


def test_dedupe_keeps_record_with_same_token_but_different_key():
    # dedupe is on (txHash, logIndex) ONLY -- never token address, per
    # ARCHITECTURE.md §4 step 4.
    existing = set()
    records = [
        {"txHash": "0xabc", "logIndex": 0, "token": "0xSAME"},
        {"txHash": "0xabc", "logIndex": 1, "token": "0xSAME"},
    ]
    result = crawl.dedupe_records(records, existing)
    assert len(result) == 2


def test_dedupe_across_reorg_rescan_overlap_collapses_identical_keys():
    # Simulates a reorg-window re-scan: the same block range is scanned
    # twice, producing byte-identical events (same txHash/logIndex) both
    # times. The second scan's records must be fully dropped.
    first_scan = [{"txHash": "0xreorg1", "logIndex": 0, "token": "0xA"}]
    existing_keys_after_first_commit = {("0xreorg1", 0)}
    second_scan_same_range = [{"txHash": "0xreorg1", "logIndex": 0, "token": "0xA"}]
    result = crawl.dedupe_records(second_scan_same_range, existing_keys_after_first_commit)
    assert result == []


def test_dedupe_preserves_order_of_surviving_records():
    existing = set()
    records = [
        {"txHash": "0x1", "logIndex": 0, "block": 100},
        {"txHash": "0x2", "logIndex": 0, "block": 101},
        {"txHash": "0x3", "logIndex": 0, "block": 102},
    ]
    result = crawl.dedupe_records(records, existing)
    assert [r["block"] for r in result] == [100, 101, 102]


# --- all-or-nothing commit ----------------------------------------------------
class _FailingRpcClient:
    """An RPC client whose first log-window request raises, simulating an
    unrecoverable mid-run RPC failure after some work has already happened
    in memory."""

    def get_logs(self, *args, **kwargs):
        raise RuntimeError("simulated unrecoverable RPC failure")

    def call_batch(self, *args, **kwargs):
        raise RuntimeError("simulated unrecoverable RPC failure")


@pytest.fixture
def committed_data_dir(tmp_path):
    state = _state(first=1000, last=1500)
    (tmp_path / "state.json").write_text(json.dumps(state))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))
    (tmp_path / "launches").mkdir()
    (tmp_path / "graduations").mkdir()
    (tmp_path / "launches" / "2026-09-06.jsonl").write_text("")
    (tmp_path / "graduations" / "2026-09-06.jsonl").write_text("")
    return tmp_path


def test_run_with_window_failure_writes_nothing_and_leaves_state_unchanged(committed_data_dir):
    state_before = (committed_data_dir / "state.json").read_bytes()
    launches_before = (committed_data_dir / "launches" / "2026-09-06.jsonl").read_bytes()

    with pytest.raises(Exception):
        crawl.run(data_dir=committed_data_dir, rpc_client=_FailingRpcClient(), head_block=2000)

    state_after = (committed_data_dir / "state.json").read_bytes()
    launches_after = (committed_data_dir / "launches" / "2026-09-06.jsonl").read_bytes()
    assert state_before == state_after
    assert launches_before == launches_after


def test_run_with_no_new_blocks_and_no_new_records_makes_no_file_writes(committed_data_dir):
    state_before_mtime_bytes = (committed_data_dir / "state.json").read_bytes()

    class _EmptyRpcClient:
        def get_logs(self, *a, **k):
            return []

        def call_batch(self, *a, **k):
            return []

    result = crawl.run(
        data_dir=committed_data_dir, rpc_client=_EmptyRpcClient(), head_block=1500  # == lastIndexedBlock, nothing new
    )
    state_after_bytes = (committed_data_dir / "state.json").read_bytes()
    assert state_before_mtime_bytes == state_after_bytes
    assert result.get("committed") is False


# --- shared stub RPC for whole-run tests -------------------------------------
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
_TOKEN_LAUNCHED_TOPIC0 = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"
_POOL_GRADUATED_TOPIC0 = "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259"


def _word(value: int) -> str:
    return format(value, "064x")


def _addr_topic(addr: str) -> str:
    return "0x" + addr[2:].rjust(64, "0")


def _launch_log(token, block, tx_hash, log_index=0, pair_token=ZERO_ADDRESS):
    return {
        "topics": [
            _TOKEN_LAUNCHED_TOPIC0,
            _addr_topic(token),
            _addr_topic("0xf6e86610771ee7838cabe2f9c376265ca25ef04c"),
            _addr_topic("0x3102c27b522664e643441bf86492bf652c2251ca"),
        ],
        "data": "0x" + _word(int(pair_token, 16)) + _word(0) + _word(4 * 10**18),
        "blockNumber": hex(block),
        "transactionHash": tx_hash,
        "logIndex": hex(log_index),
    }


def _grad_log(token, block, tx_hash, log_index=0):
    return {
        "topics": [_POOL_GRADUATED_TOPIC0, _addr_topic(token)],
        "data": "0x" + _word(1) + _word(10**24) + _word(8_090_000_094),
        "blockNumber": hex(block),
        "transactionHash": tx_hash,
        "logIndex": hex(log_index),
    }


class _StubRpc:
    """Serves canned logs, block timestamps and a well-formed 15-word
    getLaunchedToken return."""

    def __init__(self, launch_logs=(), grad_logs=(), timestamps=None):
        self.launch_logs = list(launch_logs)
        self.grad_logs = list(grad_logs)
        self.timestamps = dict(timestamps or {})

    def get_logs(self, from_block, to_block, topic0):
        source = self.launch_logs if topic0 == _TOKEN_LAUNCHED_TOPIC0 else self.grad_logs
        return [log for log in source if from_block <= int(log["blockNumber"], 16) <= to_block]

    def call_batch(self, requests):
        results = []
        for request in requests:
            if request["method"] == "eth_getBlockByNumber":
                block = int(request["params"][0], 16)
                results.append({"timestamp": hex(self.timestamps[block])})
            else:
                words = [0] * 15
                words[8] = 300
                results.append("0x" + "".join(_word(w) for w in words))
        return results

    def symbol_of(self, address):
        return "STUB"


def _iso_day_ts(day: str, hour: int = 12) -> int:
    from datetime import datetime, timezone

    return int(datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00").replace(tzinfo=timezone.utc).timestamp())


@pytest.fixture
def run_dir(tmp_path):
    (tmp_path / "state.json").write_text(json.dumps(_state(first=1000, last=1500)))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))
    (tmp_path / "launches").mkdir()
    (tmp_path / "graduations").mkdir()
    return tmp_path


def _now(day="2026-09-06", hour=12):
    from datetime import datetime, timezone

    return datetime(*(int(p) for p in day.split("-")), hour, 0, 0, tzinfo=timezone.utc)


def _write_partition(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records))


def _read_partition(kind_dir, day):
    """Read a day's records whichever extension it currently carries."""
    plain, gz = kind_dir / f"{day}.jsonl", kind_dir / f"{day}.jsonl.gz"
    if gz.exists():
        with gzip.open(gz, "rt") as f:
            text = f.read()
    else:
        text = plain.read_text()
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _launch_record(token, block, tx_hash, ts, log_index=0):
    return {
        "token": token, "curve": "0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
        "deployer": "0x3102c27b522664e643441bf86492bf652c2251ca",
        "pairToken": ZERO_ADDRESS, "pairClass": "eth", "creatorTaxBps": 300,
        "block": block, "ts": ts, "txHash": tx_hash, "logIndex": log_index,
    }


# --- B3: the dedupe day set comes from the records, not from `now` -----------
def test_dedupe_day_set_covers_days_older_than_yesterday_after_an_outage(run_dir, monkeypatch):
    """After a multi-day outage the reorg re-scan can reach blocks whose
    timestamps land days before `now`. Keying the dedupe day set off `now`
    misses those partitions and re-appends every record, inflating the
    launch denominator."""
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    old_ts = _iso_day_ts("2026-09-01")
    _write_partition(
        run_dir / "launches" / "2026-09-01.jsonl",
        [_launch_record("0x" + "1" * 40, 1400, "0x" + "aa" * 32, old_ts)],
    )
    rpc = _StubRpc(
        launch_logs=[_launch_log("0x" + "1" * 40, 1400, "0x" + "aa" * 32)],
        timestamps={1400: old_ts},
    )

    crawl.run(data_dir=run_dir, rpc_client=rpc, head_block=1600, now=_now("2026-09-06"))

    records = _read_partition(run_dir / "launches", "2026-09-01")
    assert len(records) == 1  # the re-scanned record was recognised, not duplicated
    state = json.loads((run_dir / "state.json").read_text())
    assert state["counts"]["launches"] == 1


def test_new_records_from_two_days_are_both_deduped(run_dir, monkeypatch):
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    ts_a, ts_b = _iso_day_ts("2026-09-05", 23), _iso_day_ts("2026-09-06", 1)
    _write_partition(run_dir / "launches" / "2026-09-05.jsonl",
                     [_launch_record("0x" + "2" * 40, 1400, "0x" + "bb" * 32, ts_a)])
    _write_partition(run_dir / "launches" / "2026-09-06.jsonl",
                     [_launch_record("0x" + "3" * 40, 1450, "0x" + "cc" * 32, ts_b)])
    rpc = _StubRpc(
        launch_logs=[
            _launch_log("0x" + "2" * 40, 1400, "0x" + "bb" * 32),
            _launch_log("0x" + "3" * 40, 1450, "0x" + "cc" * 32),
        ],
        timestamps={1400: ts_a, 1450: ts_b},
    )

    crawl.run(data_dir=run_dir, rpc_client=rpc, head_block=1600, now=_now("2026-09-06"))

    state = json.loads((run_dir / "state.json").read_text())
    assert state["counts"]["launches"] == 2


# --- W12: orphan is decided against every known launch, not just this run ----
def test_graduation_of_an_earlier_launch_is_not_marked_orphan(run_dir, monkeypatch):
    """Steady state: a token launched hours ago graduates now. Its launch is
    in an existing partition, not in this run's new records."""
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    token = "0x" + "4" * 40
    launch_ts = _iso_day_ts("2026-09-05")
    grad_ts = _iso_day_ts("2026-09-06")
    _write_partition(run_dir / "launches" / "2026-09-05.jsonl",
                     [_launch_record(token, 1400, "0x" + "dd" * 32, launch_ts)])
    rpc = _StubRpc(
        grad_logs=[_grad_log(token, 1550, "0x" + "ee" * 32)],
        timestamps={1550: grad_ts},
    )

    crawl.run(data_dir=run_dir, rpc_client=rpc, head_block=1600, now=_now("2026-09-06"))

    grads = [json.loads(l) for l in (run_dir / "graduations" / "2026-09-06.jsonl").read_text().splitlines() if l.strip()]
    assert len(grads) == 1
    assert grads[0]["orphan"] is False
    state = json.loads((run_dir / "state.json").read_text())
    assert state["counts"]["orphanGraduations"] == 0


def test_graduation_of_a_never_seen_token_is_still_marked_orphan(run_dir, monkeypatch):
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    grad_ts = _iso_day_ts("2026-09-06")
    rpc = _StubRpc(grad_logs=[_grad_log("0x" + "5" * 40, 1550, "0x" + "ff" * 32)], timestamps={1550: grad_ts})

    crawl.run(data_dir=run_dir, rpc_client=rpc, head_block=1600, now=_now("2026-09-06"))

    grads = [json.loads(l) for l in (run_dir / "graduations" / "2026-09-06.jsonl").read_text().splitlines() if l.strip()]
    assert grads[0]["orphan"] is True
    state = json.loads((run_dir / "state.json").read_text())
    assert state["counts"]["orphanGraduations"] == 1


# --- W11: the whole write phase is staged, then renamed ----------------------
def test_a_failure_after_the_scan_writes_no_partition_line(run_dir, monkeypatch):
    """number.json is computed from the staged records BEFORE anything is
    renamed into place, so a failure there must not leave new launch lines
    (or a half-written pair-tokens.json) behind."""
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)

    def _boom(*a, **k):
        raise RuntimeError("simulated stats failure")

    monkeypatch.setattr(crawl, "build_number", _boom)
    ts = _iso_day_ts("2026-09-06")
    rpc = _StubRpc(launch_logs=[_launch_log("0x" + "6" * 40, 1550, "0x" + "12" * 32)], timestamps={1550: ts})
    state_before = (run_dir / "state.json").read_bytes()

    with pytest.raises(Exception):
        crawl.run(data_dir=run_dir, rpc_client=rpc, head_block=1600, now=_now("2026-09-06"))

    assert not (run_dir / "launches" / "2026-09-06.jsonl").exists()
    assert (run_dir / "state.json").read_bytes() == state_before
    assert list((run_dir / "launches").glob("*.tmp")) == []


def test_successful_run_leaves_no_temp_files_behind(run_dir, monkeypatch):
    monkeypatch.setattr(crawl.time, "sleep", lambda *_: None)
    ts = _iso_day_ts("2026-09-06")
    rpc = _StubRpc(launch_logs=[_launch_log("0x" + "7" * 40, 1550, "0x" + "34" * 32)], timestamps={1550: ts})

    crawl.run(data_dir=run_dir, rpc_client=rpc, head_block=1600, now=_now("2026-09-06"))

    assert list(run_dir.rglob("*.tmp")) == []
    assert (run_dir / "number.json").exists()


# --- backfill extends history backwards once firstIndexedBlock is set --------
def test_backfill_with_existing_history_crawls_backwards_from_first_indexed_block(committed_data_dir):
    seen = []

    class _RecordingRpcClient:
        def get_logs(self, frm, to, topic0):
            seen.append((frm, to))
            return []

        def call_batch(self, *a, **k):
            return []

    state = json.loads((committed_data_dir / "state.json").read_text())
    first, last = state["firstIndexedBlock"], state["lastIndexedBlock"]
    hours = 1
    blocks_back = int(hours * 3600 / crawl.AVG_BLOCK_SECONDS)

    crawl.run(data_dir=committed_data_dir, rpc_client=_RecordingRpcClient(),
              head_block=last + 5000, backfill_hours=hours)

    assert seen, "backfill must scan something when history exists"
    assert min(f for f, _ in seen) == max(0, first - blocks_back)
    assert max(t for _, t in seen) == first - 1, "backfill never re-reads the head range"
    after = json.loads((committed_data_dir / "state.json").read_text())
    assert after["firstIndexedBlock"] == max(0, first - blocks_back)
    assert after["lastIndexedBlock"] == last, "a backfill does not move the forward cursor"
