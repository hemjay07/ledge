"""
pipeline/stats.py — ttg_percentiles(w) and fast_shares(w)

Percentile definition (ARCHITECTURE.md §6), binding, nearest-rank:
    Sort time-to-graduation ascending.
    idx = ceil(p/100 * n) - 1, clamped to [0, n-1].
    Integer seconds.
    If matched graduations < 30, every percentile is null and
    ttg.insufficient = true.
"""
import math

from pipeline.stats import fast_shares, ttg_percentiles, window


def _nearest_rank(sorted_values: list[int], p: int) -> int:
    n = len(sorted_values)
    idx = math.ceil(p / 100 * n) - 1
    idx = max(0, min(n - 1, idx))
    return sorted_values[idx]


def _build_window(make_launch, make_grad, deltas: list[int]):
    launches = []
    graduations = []
    for i, delta in enumerate(deltas):
        tok = f"0xP{i:039x}"
        launches.append(make_launch(token=tok, ts=0))
        graduations.append(make_grad(token=tok, ts=delta))
    return window(launches, graduations, since=None, until=10**12)


def test_percentiles_insufficient_below_30_matched_graduations(make_launch, make_grad):
    deltas = list(range(1, 30))  # 29 matched graduations
    w = _build_window(make_launch, make_grad, deltas)
    result = ttg_percentiles(w)
    assert result["n"] == 29
    assert result["insufficient"] is True
    for key in ("p10", "p25", "p50", "p75", "p90", "p95", "max"):
        assert result[key] is None


def test_percentiles_sufficient_at_exactly_30_matched_graduations(make_launch, make_grad):
    deltas = list(range(1, 31))  # 30 matched graduations, 1..30 seconds
    w = _build_window(make_launch, make_grad, deltas)
    result = ttg_percentiles(w)
    assert result["n"] == 30
    assert result["insufficient"] is False
    sorted_deltas = sorted(deltas)
    for p, key in ((10, "p10"), (25, "p25"), (50, "p50"), (75, "p75"), (90, "p90"), (95, "p95")):
        assert result[key] == _nearest_rank(sorted_deltas, p)
    assert result["max"] == sorted_deltas[-1]


def test_percentiles_nearest_rank_matches_manual_computation_on_big_fixture(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    launch_ts = {r["token"]: r["ts"] for r in launches}
    deltas = sorted(
        g["ts"] - launch_ts[g["token"]] for g in graduations if g["token"] in launch_ts
    )
    result = ttg_percentiles(w)
    assert result["n"] == len(deltas)
    for p, key in ((10, "p10"), (25, "p25"), (50, "p50"), (75, "p75"), (90, "p90"), (95, "p95")):
        assert result[key] == _nearest_rank(deltas, p)
    assert result["max"] == deltas[-1]
    assert result["insufficient"] is False


def test_percentiles_are_integer_seconds(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    result = ttg_percentiles(w)
    for key in ("p10", "p25", "p50", "p75", "p90", "p95", "max"):
        assert isinstance(result[key], int)


def test_percentiles_p10_le_p50_le_p90_le_max_monotonic(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    result = ttg_percentiles(w)
    assert result["p10"] <= result["p25"] <= result["p50"] <= result["p75"]
    assert result["p75"] <= result["p90"] <= result["p95"] <= result["max"]


def test_percentiles_exclude_orphan_graduations(make_launch, make_grad):
    launches = [make_launch(token="0xQ", ts=0)]
    graduations = [
        make_grad(token="0xQ", ts=100),
        make_grad(token="0xORPHAN", ts=5000),  # no matching launch
    ]
    w = window(launches, graduations, since=None, until=10**12)
    result = ttg_percentiles(w)
    # only 1 matched graduation -> n=1, well below MIN_N -> insufficient
    assert result["n"] == 1
    assert result["insufficient"] is True


# --- fast_shares ------------------------------------------------------------
def test_fast_shares_under_300_and_under_60_counts(make_launch, make_grad):
    deltas = [10, 50, 61, 299, 300, 301, 1000] + list(range(1001, 1024))  # >=30 total
    w = _build_window(make_launch, make_grad, deltas)
    result = fast_shares(w)
    under60 = sum(1 for d in deltas if d < 60)
    under300 = sum(1 for d in deltas if d < 300)
    n = len(deltas)
    assert result["n"] == n
    assert result["under60Share"] == round(under60 / n, 6)
    assert result["under300Share"] == round(under300 / n, 6)


def test_fast_shares_on_big_fixture_matches_manual_computation(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    launch_ts = {r["token"]: r["ts"] for r in launches}
    deltas = [
        g["ts"] - launch_ts[g["token"]] for g in graduations if g["token"] in launch_ts
    ]
    n = len(deltas)
    under60 = sum(1 for d in deltas if d < 60)
    under300 = sum(1 for d in deltas if d < 300)
    result = fast_shares(w)
    assert result["n"] == n
    assert result["under60Share"] == round(under60 / n, 6)
    assert result["under300Share"] == round(under300 / n, 6)


# --- B6: fast_shares is gated on MIN_N like every other rate ----------------
def test_fast_shares_below_min_n_returns_null_shares_and_insufficient(make_launch, make_grad):
    deltas = [10, 50, 299, 400]  # 4 matched graduations, far below MIN_N=30
    w = _build_window(make_launch, make_grad, deltas)
    result = fast_shares(w)
    assert result["n"] == 4
    assert result["insufficient"] is True
    assert result["under300Share"] is None
    assert result["under60Share"] is None


def test_fast_shares_with_no_graduations_returns_null_not_zero(make_launch):
    """CONSTRAINTS.md #4: an empty population is "not enough data", never a
    0% share -- 0.0 reads as a measured finding."""
    launches = [make_launch(ts=1_000) for _ in range(50)]
    w = window(launches, [], since=None, until=10**12)
    result = fast_shares(w)
    assert result["n"] == 0
    assert result["insufficient"] is True
    assert result["under300Share"] is None
    assert result["under60Share"] is None


def test_fast_shares_at_exactly_min_n_is_sufficient(make_launch, make_grad):
    deltas = [10] * 15 + [400] * 15  # exactly 30 matched graduations
    w = _build_window(make_launch, make_grad, deltas)
    result = fast_shares(w)
    assert result["n"] == 30
    assert result["insufficient"] is False
    assert result["under300Share"] == 0.5


def test_fast_shares_one_below_min_n_is_insufficient(make_launch, make_grad):
    deltas = [10] * 29
    w = _build_window(make_launch, make_grad, deltas)
    result = fast_shares(w)
    assert result["n"] == 29
    assert result["insufficient"] is True
    assert result["under300Share"] is None
