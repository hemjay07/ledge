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
