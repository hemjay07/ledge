"""
`crawledAt` is chain time, never wall-clock time (METHOD.md "Freshness").

The blocker these tests pin down (B1): the backwards backfill stamped
`crawledAt` with the run's wall clock while `lastIndexedBlock` stayed at the
older forward cursor. The trailing-24h window `[crawledAt - 86400,
crawledAt)` then reached ~81 minutes past the last block LEDGE had indexed.
Those minutes hold no launches because they were never scanned, so the
denominator was understated and the rate overstated -- and nothing in
`recompute.py --check` could see it, because the file and the recompute
agreed on the same wrong instant.

The definition, not the symptom, is what is fixed here:

  - `crawledAt` is the block timestamp of `lastIndexedBlock`, published by
    the crawl as `state.json`'s `lastIndexedAt` and read straight back by
    `recompute.py`. It is a block header, so it can never run ahead of the
    chain LEDGE has read.
  - `lastRunAt` / `lastSuccessAt` stay wall-clock: they answer "did the run
    that wrote this file know it was behind" (the `stale` flag), and nothing
    else.
  - A run that indexes nothing new leaves `crawledAt` where it was, and a
    backwards backfill -- which never advances `lastIndexedBlock` -- leaves
    it alone too.

The invariant every window must satisfy is at the bottom:
`until` never runs past indexed chain time.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.recompute import load_partitions, recompute
from pipeline.stats import format_iso

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"

# A block is ~0.101 s of chain (ARCHITECTURE.md §2). One "block interval" of
# slack is allowed between the newest record and indexed chain time per block
# scanned past it; a whole second per block is generous and still catches a
# wall-clock stamp, which runs minutes to hours ahead of the last block.
MAX_BLOCK_SECONDS = 1.0

CHAIN_TS = 1788717352  # 2026-09-06T17:55:52Z -- the newest launch in the record
WALL_TS = CHAIN_TS + 4860  # the run's clock, 81 minutes ahead of chain time


def _state(**overrides) -> dict:
    state = {
        "version": 1,
        "firstIndexedBlock": 55_173_069,
        "lastIndexedBlock": 56_172_588,
        "reorgWindow": 3000,
        "lastRunAt": format_iso(WALL_TS),
        "lastSuccessAt": format_iso(WALL_TS),
        "consecutiveFailures": 0,
        "lastError": None,
        "counts": {"launches": 0, "graduations": 0, "orphanGraduations": 0, "enrichmentFailures": 0},
    }
    state.update(overrides)
    return state


def _write_data_dir(tmp_path: Path, launches: list, graduations: list, state: dict) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "state.json").write_text(json.dumps(state))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))
    for kind, records in (("launches", launches), ("graduations", graduations)):
        day_dir = tmp_path / kind
        day_dir.mkdir()
        (day_dir / "2026-09-06.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in records)
        )
    return tmp_path


@pytest.fixture
def record(make_launch):
    """30 launches on an hourly cadence -- a 29-hour record, longer than the
    24h window, so moving the window's close moves its contents. The newest
    lands at CHAIN_TS, in block 56,172,508; the cursor is 80 blocks further
    on, which is the shape of the committed record."""
    return [
        make_launch(block=56_172_508 - (29 - i) * 36_000, ts=CHAIN_TS - (29 - i) * 3600)
        for i in range(30)
    ]


# --- the definition ----------------------------------------------------------
def test_crawled_at_is_the_chain_time_of_the_last_indexed_block(tmp_path, record):
    state = _state(lastIndexedAt=format_iso(CHAIN_TS + 8))
    number = recompute(_write_data_dir(tmp_path, record, [], state))
    assert number["crawledAt"] == format_iso(CHAIN_TS + 8)


def test_crawled_at_ignores_the_wall_clock_of_the_run_that_wrote_the_state(tmp_path, record):
    """B1 itself: lastSuccessAt is 81 minutes ahead of the last block indexed.
    The published instant must be the block's, not the clock's."""
    state = _state(lastIndexedAt=format_iso(CHAIN_TS + 8))
    number = recompute(_write_data_dir(tmp_path, record, [], state))
    assert number["crawledAt"] != state["lastSuccessAt"]
    assert number["crawledAt"] != state["lastRunAt"]


def test_the_24h_window_does_not_reach_past_the_last_block_indexed(tmp_path, record):
    """The 81 minutes the wall clock added were never scanned, so they held
    no launches: the window that includes them understates its denominator."""
    chain_state = _state(lastIndexedAt=format_iso(CHAIN_TS + 8))
    chain = recompute(_write_data_dir(tmp_path / "chain", record, [], chain_state))

    wall = recompute(
        _write_data_dir(tmp_path / "wall", record, [], _state(lastIndexedAt=format_iso(WALL_TS)))
    )

    assert chain["h24"]["until"] == CHAIN_TS + 8
    assert chain["h24"]["until"] - chain["h24"]["since"] == 86400
    # the wall-clock instant loses the oldest launches of the window: its
    # `since` has walked 81 minutes forward over indexed time.
    assert wall["h24"]["launches"] < chain["h24"]["launches"]


def test_a_state_written_before_last_indexed_at_falls_back_to_chain_time(tmp_path, record):
    """Legacy state files carry no `lastIndexedAt`. The fallback is a second
    past the newest launch in the record -- a block header plus the tick that
    closes the half-open window after it, and still short of indexed chain
    time. It is never `lastSuccessAt`."""
    number = recompute(_write_data_dir(tmp_path, record, [], _state()))
    assert number["crawledAt"] == format_iso(CHAIN_TS + 1)


def test_an_empty_record_with_no_last_indexed_at_stays_at_the_epoch(tmp_path):
    number = recompute(_write_data_dir(tmp_path, [], [], _state()))
    assert number["crawledAt"] == "1970-01-01T00:00:00Z"


# --- the invariant -----------------------------------------------------------
def assert_windows_within_indexed_chain_time(number: dict, launches: list, state: dict) -> None:
    """No window may extend past indexed chain time.

    Two assertions, because "indexed chain time" has to be pinned to a block
    or the first assertion is vacuous:

      1. every window's `until` is at or before the chain time of the last
         indexed block;
      2. that chain time is itself within one block interval per block of
         the newest record in the file -- which a wall-clock stamp, minutes
         or hours ahead of the last block scanned, can never be.
    """
    frontier = number["crawledAt"]
    for name in ("h24", "allTime"):
        until = number[name]["until"]
        assert until <= _parse(frontier), f"{name}.until runs past indexed chain time"

    newest = max(launches, key=lambda l: l["ts"])
    blocks_past = max(0, state["lastIndexedBlock"] - newest["block"]) + 1
    assert _parse(frontier) - newest["ts"] <= blocks_past * MAX_BLOCK_SECONDS, (
        "crawledAt is further past the newest record than the blocks scanned "
        "after it can account for -- it is not a block timestamp"
    )


def _parse(iso: str) -> int:
    from datetime import datetime, timezone

    return int(datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def test_the_invariant_holds_for_a_chain_time_measurement(tmp_path, record):
    state = _state(lastIndexedAt=format_iso(CHAIN_TS + 8))
    number = recompute(_write_data_dir(tmp_path, record, [], state))
    assert_windows_within_indexed_chain_time(number, record, state)


def test_the_invariant_catches_a_wall_clock_measurement(tmp_path, record):
    """The guard above is only worth having if it fires on B1's own shape."""
    state = _state(lastIndexedAt=format_iso(WALL_TS))
    number = recompute(_write_data_dir(tmp_path, record, [], state))
    with pytest.raises(AssertionError):
        assert_windows_within_indexed_chain_time(number, record, state)


@pytest.mark.skipif(not (DATA_DIR / "number.json").exists(), reason="no committed data")
def test_the_committed_number_file_holds_the_invariant():
    """The published file, not a fixture: this is where B1 was found."""
    number = json.loads((DATA_DIR / "number.json").read_text())
    state = json.loads((DATA_DIR / "state.json").read_text())
    launches = load_partitions(DATA_DIR / "launches")
    assert launches, "no launches in the committed record"
    assert_windows_within_indexed_chain_time(number, launches, state)
