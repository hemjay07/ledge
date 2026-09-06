"""
pipeline/stats.py — ttg_ladder(w) and the ttg block it ships inside.

Definition (ARCHITECTURE-PHASE2-4.md §0, "Decision: the ladder"), binding:

    LADDER_EDGES is a fixed, ascending list of second marks. It is a
    definition: moving an edge needs a dated /method changelog entry.

    For each edge, `cumulative` is the number of matched graduations whose
    time to graduation is STRICTLY LESS than that edge — the same
    convention as the fast-graduation cutoff ("graduated inside 5 minutes"
    is ttg < 300), so the rung at 300 s equals fastShares.under300Share
    and the rung at 60 s equals fastShares.under60Share by construction.

    `cumulative` is always the raw count, so a reader can check the share.
    `cumulativeShare` is null for every rung when the ttg block is
    insufficient (matched graduations < 30) — never 0.0, which would read
    as a measured finding (CONSTRAINTS.md #4).

    The counts are monotone non-decreasing, because the edges ascend.

The live layer does a table lookup into this ladder and never divides;
that is the whole reason the table exists.
"""
from bisect import bisect_left

from pipeline.stats import (
    LADDER_EDGES,
    MIN_N,
    fast_shares,
    ttg_block,
    ttg_ladder,
    ttg_percentiles,
    window,
)


def _build_window(make_launch, make_grad, deltas: list[int]):
    launches = []
    graduations = []
    for i, delta in enumerate(deltas):
        tok = f"0xL{i:039x}"
        launches.append(make_launch(token=tok, ts=0))
        graduations.append(make_grad(token=tok, ts=delta))
    return window(launches, graduations, since=None, until=10**12)


def test_ladder_edges_are_the_published_definition():
    assert LADDER_EDGES == (30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600)


def test_ladder_edges_ascend_strictly():
    assert list(LADDER_EDGES) == sorted(set(LADDER_EDGES))


def test_ladder_has_one_rung_per_edge_in_edge_order(make_launch, make_grad):
    w = _build_window(make_launch, make_grad, list(range(1, 41)))
    rungs = ttg_ladder(w)
    assert [r["atSeconds"] for r in rungs] == list(LADDER_EDGES)
    for rung in rungs:
        assert set(rung) == {"atSeconds", "cumulative", "cumulativeShare"}


def test_ladder_counts_are_strictly_less_than_the_edge(make_launch, make_grad):
    # 30 graduations, one every 10 s from 10 s to 300 s: exactly one lands
    # on the 300 s edge and must NOT be counted at that rung.
    deltas = [10 * i for i in range(1, 31)]
    w = _build_window(make_launch, make_grad, deltas)
    rungs = {r["atSeconds"]: r for r in ttg_ladder(w)}
    assert rungs[30]["cumulative"] == 2  # 10, 20
    assert rungs[60]["cumulative"] == 5  # 10..50
    assert rungs[300]["cumulative"] == 29  # 10..290, not the one at 300
    assert rungs[600]["cumulative"] == 30


def test_ladder_counts_are_monotone_non_decreasing(make_launch, make_grad):
    deltas = [1, 45, 45, 200, 299, 300, 301, 1000, 5000, 40000] * 4
    w = _build_window(make_launch, make_grad, deltas)
    counts = [r["cumulative"] for r in ttg_ladder(w)]
    assert counts == sorted(counts)


def test_ladder_shares_are_the_count_over_n(make_launch, make_grad):
    deltas = list(range(1, 61))  # n = 60
    w = _build_window(make_launch, make_grad, deltas)
    for rung in ttg_ladder(w):
        assert rung["cumulativeShare"] == round(rung["cumulative"] / 60, 6)


def test_ladder_is_insufficient_below_30_matched_graduations(make_launch, make_grad):
    deltas = list(range(1, 30))  # 29
    w = _build_window(make_launch, make_grad, deltas)
    rungs = ttg_ladder(w)
    assert all(r["cumulativeShare"] is None for r in rungs)
    # the raw counts survive: the ladder still says what was observed
    assert rungs[0]["cumulative"] == 29
    assert ttg_percentiles(w)["insufficient"] is True


def test_ladder_shares_appear_at_exactly_30(make_launch, make_grad):
    deltas = list(range(1, 31))  # 30
    w = _build_window(make_launch, make_grad, deltas)
    rungs = ttg_ladder(w)
    assert all(r["cumulativeShare"] is not None for r in rungs)


def test_ladder_of_an_empty_population_is_all_zero_and_null(make_launch):
    w = window([make_launch(ts=0)], [], since=None, until=10**12)
    rungs = ttg_ladder(w)
    assert [r["cumulative"] for r in rungs] == [0] * len(LADDER_EDGES)
    assert all(r["cumulativeShare"] is None for r in rungs)


def test_last_rung_may_be_below_n_when_a_graduation_is_slower_than_the_top_edge(
    make_launch, make_grad
):
    deltas = list(range(1, 30)) + [LADDER_EDGES[-1] + 1]  # n = 30
    w = _build_window(make_launch, make_grad, deltas)
    rungs = ttg_ladder(w)
    assert rungs[-1]["cumulative"] == 29
    assert rungs[-1]["cumulativeShare"] == round(29 / 30, 6)


def test_ladder_rungs_at_300_and_60_agree_with_fast_shares(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    rungs = {r["atSeconds"]: r for r in ttg_ladder(w)}
    shares = fast_shares(w)
    assert rungs[300]["cumulativeShare"] == shares["under300Share"]
    assert rungs[60]["cumulativeShare"] == shares["under60Share"]


def test_ladder_on_big_fixture_matches_a_manual_count(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    launch_ts = {r["token"]: r["ts"] for r in launches}
    deltas = sorted(
        g["ts"] - launch_ts[g["token"]] for g in graduations if g["token"] in launch_ts
    )
    assert len(deltas) == 535
    for rung in ttg_ladder(w):
        assert rung["cumulative"] == bisect_left(deltas, rung["atSeconds"])
        assert rung["cumulativeShare"] == round(rung["cumulative"] / 535, 6)


def test_ttg_block_carries_the_percentiles_and_the_ladder(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    block = ttg_block(w)
    percentiles = ttg_percentiles(w)
    for key, value in percentiles.items():
        assert block[key] == value
    assert block["ladder"] == ttg_ladder(w)
    assert block["n"] == 535
    assert block["insufficient"] is False
    assert MIN_N == 30
