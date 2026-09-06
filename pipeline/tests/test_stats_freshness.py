"""
pipeline/stats.py — build_number(launches, graduations, state, crawled_at)

Freshness rules (ARCHITECTURE.md §7 / METHOD.md):
  - number.json always carries crawledAt and staleAfterSeconds.
  - `stale` is true ONLY when the generating run knows the data is already
    old at generation time (lastRunAt vs lastSuccessAt more than
    staleAfterSeconds apart). In the normal path (a successful run,
    lastRunAt == lastSuccessAt) it is false.
  - Wall-clock staleness (browser-side, "updated N min ago" / stale banner)
    is explicitly NOT computed here -- build_number never reads a live
    clock; `stale` reflects only what state.json already records.
"""
from pipeline.stats import build_number, window  # noqa: F401  (window imported for parity)


def _state(last_run_at="2026-09-06T12:45:03Z", last_success_at="2026-09-06T12:45:03Z"):
    return {
        "version": 1,
        "firstIndexedBlock": 55219400,
        "lastIndexedBlock": 55919382,
        "reorgWindow": 3000,
        "lastRunAt": last_run_at,
        "lastSuccessAt": last_success_at,
        "consecutiveFailures": 0,
        "lastError": None,
        "counts": {
            "launches": 23552,
            "graduations": 559,
            "orphanGraduations": 24,
            "enrichmentFailures": 0,
        },
    }


def test_build_number_carries_crawled_at_from_state_last_success(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state(last_success_at="2026-09-06T12:45:03Z")
    result = build_number(launches, [], state, crawled_at="2026-09-06T12:45:03Z")
    assert result["crawledAt"] == "2026-09-06T12:45:03Z"


def test_build_number_always_includes_stale_after_seconds(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state()
    result = build_number(launches, [], state, crawled_at="2026-09-06T12:45:03Z")
    assert "staleAfterSeconds" in result
    assert isinstance(result["staleAfterSeconds"], int)
    assert result["staleAfterSeconds"] > 0


def test_stale_is_false_in_the_normal_successful_run_path(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state(last_run_at="2026-09-06T12:45:03Z", last_success_at="2026-09-06T12:45:03Z")
    result = build_number(launches, [], state, crawled_at="2026-09-06T12:45:03Z")
    assert result["stale"] is False


def test_stale_is_true_when_last_success_predates_generation_beyond_threshold(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    # lastRunAt is well over 2 hours (default staleAfterSeconds=7200) after
    # lastSuccessAt -- the generating run knows its own data is old.
    state = _state(
        last_run_at="2026-09-06T15:00:03Z",
        last_success_at="2026-09-06T12:45:03Z",
    )
    result = build_number(launches, [], state, crawled_at="2026-09-06T12:45:03Z")
    assert result["stale"] is True


def test_build_number_includes_head_and_first_indexed_block(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state()
    result = build_number(launches, [], state, crawled_at="2026-09-06T12:45:03Z")
    assert result["headBlock"] == state["lastIndexedBlock"]
    assert result["firstIndexedBlock"] == state["firstIndexedBlock"]


def test_build_number_h24_lower_bound_is_always_true(big_fixture):
    launches, graduations = big_fixture
    state = _state()
    result = build_number(launches, graduations, state, crawled_at="2026-09-06T12:45:03Z")
    assert result["h24"]["lowerBound"] is True


def test_build_number_all_time_lower_bound_is_always_false(big_fixture):
    launches, graduations = big_fixture
    state = _state()
    result = build_number(launches, graduations, state, crawled_at="2026-09-06T12:45:03Z")
    assert result["allTime"]["lowerBound"] is False


def test_build_number_all_time_since_is_null(big_fixture):
    launches, graduations = big_fixture
    state = _state()
    result = build_number(launches, graduations, state, crawled_at="2026-09-06T12:45:03Z")
    assert result["allTime"]["since"] is None


def test_build_number_is_pure_same_inputs_same_output(big_fixture):
    launches, graduations = big_fixture
    state = _state()
    r1 = build_number(launches, graduations, state, crawled_at="2026-09-06T12:45:03Z")
    r2 = build_number(launches, graduations, state, crawled_at="2026-09-06T12:45:03Z")
    assert r1 == r2


# --- W9: `stale` reports a failed run, never wall-clock age ------------------
def test_stale_is_true_when_the_previous_run_failed_even_by_one_minute(make_launch):
    """The old rule only fired past staleAfterSeconds, so a run that failed
    an hour ago published stale: false. `stale` now means exactly "this run
    reported a failure since the last success"."""
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state(last_run_at="2026-09-06T12:46:03Z", last_success_at="2026-09-06T12:45:03Z")
    result = build_number(launches, [], state, crawled_at="2026-09-06T12:45:03Z")
    assert result["stale"] is True


def test_stale_is_true_when_consecutive_failures_are_recorded(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state()
    state["consecutiveFailures"] = 1
    result = build_number(launches, [], state, crawled_at="2026-09-06T12:45:03Z")
    assert result["stale"] is True


def test_stale_is_true_before_the_first_successful_run(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state(last_success_at=None)
    result = build_number(launches, [], state, crawled_at="1970-01-01T00:00:00Z")
    assert result["stale"] is True


def test_stale_does_not_track_wall_clock_age_of_crawled_at(make_launch):
    """An ancient but successful crawl publishes stale: false -- age is the
    consumer's job, computed from crawledAt against staleAfterSeconds."""
    launches = [make_launch(ts=i) for i in range(30)]
    state = _state(last_run_at="2020-01-01T00:00:00Z", last_success_at="2020-01-01T00:00:00Z")
    result = build_number(launches, [], state, crawled_at="2020-01-01T00:00:00Z")
    assert result["stale"] is False
    assert result["crawledAt"] == "2020-01-01T00:00:00Z"
    assert result["staleAfterSeconds"] == 7200


def test_schema_version_is_2_after_nullable_shares(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    result = build_number(launches, [], _state(), crawled_at="2026-09-06T12:45:03Z")
    assert result["schemaVersion"] == 2
