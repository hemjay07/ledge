"""The stall alert (pipeline/stall_watch.py): what counts as a stall, and
when the owner is told. Born of 2026-09-15, when the live index and the
crawl failed for seven hours and nobody was told."""

from __future__ import annotations

from pipeline import stall_watch as w

NOW = 1_800_000_000
ISO = "2027-01-15T08:00:00Z"  # == NOW


def _health(**over):
    base = {"lastSuccessAt": ISO, "consecutiveFailures": 0, "lastError": None, "lastIndexedBlock": 1_000_000}
    base.update(over)
    return base


def _iso(unix: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(unix, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_healthy_has_no_conditions():
    assert w.conditions(_health(), {"crawledAt": ISO}, {"head": 1_000_500}, NOW) == {}


def test_a_stale_tick_is_named_with_its_age_and_last_error():
    c = w.conditions(
        _health(lastSuccessAt=_iso(NOW - 7 * 3600), consecutiveFailures=123, lastError="no block header for block 63852016"),
        {"crawledAt": ISO},
        None,
        NOW,
    )
    assert "tick" in c
    assert "7 h ago" in c["tick"]
    assert "123 failures" in c["tick"]
    assert "63852016" in c["tick"]


def test_a_stale_crawl_and_a_lagging_cursor_are_separate_conditions():
    c = w.conditions(_health(lastIndexedBlock=900_000), {"crawledAt": _iso(NOW - 8 * 3600)}, {"head": 1_000_000}, NOW)
    assert set(c) == {"crawl", "lag"}
    assert "100,000 blocks behind" in c["lag"]


def test_unreadable_sources_are_conditions_not_silence():
    c = w.conditions(None, None, None, NOW)
    assert set(c) == {"health", "number"}


def test_sends_once_on_a_new_stall_then_stays_quiet():
    current = {"tick": "The live index has not completed a pass since ..."}
    msg, state = w.decide(current, {}, NOW)
    assert msg is not None and msg.startswith("LEDGE stall")
    msg2, state2 = w.decide(current, state, NOW + 300)
    assert msg2 is None
    assert state2["active"] == current


def test_reminds_every_six_hours_while_the_stall_lasts():
    current = {"tick": "x"}
    _, state = w.decide(current, {}, NOW)
    msg, _ = w.decide(current, state, NOW + w.REMIND_SECONDS)
    assert msg is not None and "still" in msg


def test_sends_once_on_recovery():
    _, state = w.decide({"tick": "x"}, {}, NOW)
    msg, state2 = w.decide({}, state, NOW + 600)
    assert msg == "LEDGE recovered.\nCleared: tick."
    assert w.decide({}, state2, NOW + 900)[0] is None


def test_a_second_condition_during_a_stall_is_announced():
    _, state = w.decide({"tick": "x"}, {}, NOW)
    msg, _ = w.decide({"tick": "x", "crawl": "y"}, state, NOW + 600)
    assert msg is not None and "y" in msg
