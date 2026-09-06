"""
pipeline/stats.py — build_number(): the fields the live layer depends on.

Three of them are new in this change:

  * `firstIndexedAt` — the earliest launch timestamp present in the record,
    as an ISO-8601 Z string, beside the existing `firstIndexedBlock`. Null
    when there are no launches. It exists so a consumer can state coverage
    in hours without converting blocks to time, which METHOD.md forbids.
  * `ttg.ladder` — in both windows.
  * `cohorts.pairTax` / `cohortsExcluded.pairTax` — in both windows.
"""
from pipeline.stats import (
    LADDER_EDGES,
    PAIR_TAX_BUCKETS,
    build_number,
    first_indexed_at,
)

STATE = {
    "consecutiveFailures": 0,
    "lastRunAt": "2026-09-06T18:00:36Z",
    "lastSuccessAt": "2026-09-06T18:00:36Z",
    "firstIndexedBlock": 56028514,
    "lastIndexedBlock": 56172588,
}
CRAWLED_AT = "2026-09-06T18:00:36Z"


def test_first_indexed_at_is_the_earliest_launch_timestamp(make_launch):
    launches = [
        make_launch(ts=1_757_000_500),
        make_launch(ts=1_757_000_000),
        make_launch(ts=1_757_009_999),
    ]
    assert first_indexed_at(launches) == "2025-09-04T15:33:20Z"


def test_first_indexed_at_is_null_without_launches():
    assert first_indexed_at([]) is None


def test_number_file_carries_first_indexed_at_beside_first_indexed_block(make_launch):
    launches = [make_launch(ts=1_757_000_000)]
    number = build_number(launches, [], STATE, CRAWLED_AT)
    assert number["firstIndexedBlock"] == 56028514
    assert number["firstIndexedAt"] == "2025-09-04T15:33:20Z"


def test_number_file_first_indexed_at_is_null_when_nothing_is_indexed():
    number = build_number([], [], STATE, CRAWLED_AT)
    assert number["firstIndexedAt"] is None


def test_both_windows_carry_the_ladder_and_the_pair_tax_cohort(make_launch, make_grad):
    launches = [make_launch(ts=1_757_000_000, tax_bps=0) for _ in range(40)]
    graduations = [make_grad(token=launches[0]["token"], ts=1_757_000_400)]
    # crawledAt one minute after the launches, so the 24 h window holds them
    number = build_number(launches, graduations, STATE, "2025-09-04T15:34:20Z")
    for key in ("h24", "allTime"):
        w = number[key]
        assert [r["atSeconds"] for r in w["ttg"]["ladder"]] == list(LADDER_EDGES)
        assert [r["bucket"] for r in w["cohorts"]["pairTax"]] == PAIR_TAX_BUCKETS
        assert isinstance(w["cohortsExcluded"]["pairTax"], int)
        assert w["cohorts"]["pairTax"][0]["launches"] == 40


def test_schema_version_is_unchanged_by_the_added_fields(make_launch):
    number = build_number([make_launch(ts=1_757_000_000)], [], STATE, CRAWLED_AT)
    assert number["schemaVersion"] == 2
