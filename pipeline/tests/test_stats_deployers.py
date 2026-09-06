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
    launches = []
    for i in range(10):
        launches.append(make_launch(token=f"0xSingle{i:033x}", deployer=f"0xd{i:039x}", ts=0))
    for i in range(2):
        launches.append(make_launch(token=f"0xDbl{i:036x}", deployer="0xrepeatdeployer0000000000000000000002", ts=0))
    w = window(launches, [], since=None, until=10**12)
    result = deployers(w)
    # distinct = 11 (10 single + 1 repeat), repeat deployer counts as 1 of the 2+ bucket
    assert result["distinct"] == 11
    assert result["launched2plusShare"] == round(1 / 11, 6)


def test_deployers_from_10plus_share_is_share_of_launches_not_deployers(make_launch):
    launches = []
    top_deployer = "0xtopdeployer00000000000000000000000001"
    for i in range(10):
        launches.append(make_launch(token=f"0xTop{i:036x}", deployer=top_deployer, ts=0))
    for i in range(5):
        launches.append(make_launch(token=f"0xOther{i:034x}", deployer=f"0xo{i:039x}", ts=0))
    w = window(launches, [], since=None, until=10**12)
    result = deployers(w)
    # 10 launches out of 15 total come from a deployer with >= 10 launches
    assert result["from10plusShare"] == round(10 / 15, 6)


def test_full_number_json_shaped_output_never_leaks_an_address(big_fixture):
    """End-to-end guard: canonical_dumps of a deployers() result contains no
    address string anywhere in its bytes."""
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    result = deployers(w)
    serialized = canonical_dumps(result)
    assert ADDRESS_RE.search(serialized) is None
