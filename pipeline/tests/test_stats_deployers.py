"""
pipeline/stats.py — deployers(w)

Binding rules (ARCHITECTURE.md §6 / METHOD.md / CONSTRAINTS.md #2):
  - Aggregate only: distinct deployers, share that launched 2+, share of
    launches from deployers with 10+, launches-per-deployer histogram.
  - CONSTRAINTS.md #2: "Never print a wallet or deployer address as a
    subject." No address string may appear anywhere in the deployers()
    output (or, more broadly, in the canonical-serialized number.json).
"""
import json
import re

from pipeline.canonical import canonical_dumps
from pipeline.stats import deployers, window

ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{40}")


def test_deployers_on_big_fixture_matches_known_totals(big_fixture, known_totals):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    result = deployers(w)
    assert result["distinct"] == known_totals["distinct_deployers"]
    assert result["launched2plusShare"] == round(
        known_totals["deployers_2plus"] / known_totals["distinct_deployers"], 6
    )
    assert result["from10plusShare"] == round(
        known_totals["launches_from_10plus_deployers"] / known_totals["launches"], 6
    )


def test_deployers_output_contains_no_address_string(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    result = deployers(w)
    dumped = json.dumps(result)
    assert ADDRESS_RE.search(dumped) is None


def test_deployers_histogram_sums_to_distinct_count(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    result = deployers(w)
    total_from_histogram = sum(row["deployers"] for row in result["histogram"])
    assert total_from_histogram == result["distinct"]


def test_deployers_histogram_launches_weighted_matches_total_launches(make_launch):
    # 3 deployers each launching once, 1 deployer launching 5 times -> 8 launches, 4 distinct
    launches = []
    for i in range(3):
        launches.append(make_launch(token=f"0xS{i:039x}", deployer=f"0xdep{i:037x}", ts=0))
    for i in range(5):
        launches.append(make_launch(token=f"0xR{i:039x}", deployer="0xrepeatdeployer0000000000000000000001", ts=0))
    w = window(launches, [], since=None, until=10**12)
    result = deployers(w)
    assert result["distinct"] == 4


def test_deployers_2plus_share_excludes_single_launch_deployers(make_launch):
    # 30 single-launch deployers keeps the population at MIN_N so the share
    # is reported rather than gated (see the MIN_N tests below).
    launches = []
    for i in range(30):
        launches.append(make_launch(token=f"0xSingle{i:033x}", deployer=f"0xd{i:039x}", ts=0))
    for i in range(2):
        launches.append(make_launch(token=f"0xDbl{i:036x}", deployer="0xrepeatdeployer0000000000000000000002", ts=0))
    w = window(launches, [], since=None, until=10**12)
    result = deployers(w)
    # distinct = 31 (30 single + 1 repeat), repeat deployer counts as 1 of the 2+ bucket
    assert result["distinct"] == 31
    assert result["launched2plusShare"] == round(1 / 31, 6)


def test_deployers_from_10plus_share_is_share_of_launches_not_deployers(make_launch):
    launches = []
    top_deployer = "0xtopdeployer00000000000000000000000001"
    for i in range(10):
        launches.append(make_launch(token=f"0xTop{i:036x}", deployer=top_deployer, ts=0))
    # 20 other deployers keeps the launch population at MIN_N so the share
    # is reported rather than gated.
    for i in range(20):
        launches.append(make_launch(token=f"0xOther{i:034x}", deployer=f"0xo{i:039x}", ts=0))
    w = window(launches, [], since=None, until=10**12)
    result = deployers(w)
    # 10 launches out of 30 total come from a deployer with >= 10 launches
    assert result["from10plusShare"] == round(10 / 30, 6)


def test_full_number_json_shaped_output_never_leaks_an_address(big_fixture):
    """End-to-end guard: canonical_dumps of a deployers() result contains no
    address string anywhere in its bytes."""
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    result = deployers(w)
    serialized = canonical_dumps(result)
    assert ADDRESS_RE.search(serialized) is None


# --- B6: deployer shares are gated on MIN_N and never 0.0 on an empty set ---
def test_deployers_shares_are_null_when_population_is_below_min_n(make_launch):
    launches = [make_launch(token=f"0xT{i:038x}", deployer=f"0xd{i:039x}", ts=0) for i in range(10)]
    w = window(launches, [], since=None, until=10**12)
    result = deployers(w)
    assert result["distinct"] == 10
    assert result["insufficient"] is True
    assert result["launched2plusShare"] is None
    assert result["from10plusShare"] is None


def test_deployers_shares_are_null_on_an_empty_window(make_launch):
    """distinct == 0 must not report a 0.0 share: 0.0 reads as a measured
    finding, and CONSTRAINTS.md #4 requires "not enough data" instead."""
    w = window([], [], since=None, until=10**12)
    result = deployers(w)
    assert result["distinct"] == 0
    assert result["insufficient"] is True
    assert result["launched2plusShare"] is None
    assert result["from10plusShare"] is None


def test_deployers_shares_are_reported_at_and_above_min_n(make_launch):
    launches = [make_launch(token=f"0xT{i:038x}", deployer=f"0xd{i:039x}", ts=0) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    result = deployers(w)
    assert result["distinct"] == 30
    assert result["insufficient"] is False
    assert result["launched2plusShare"] == 0.0
    assert result["from10plusShare"] == 0.0


def test_deployers_big_fixture_is_sufficient(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    assert deployers(w)["insufficient"] is False
