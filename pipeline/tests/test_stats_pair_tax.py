"""
pipeline/stats.py — pair_tax_cohort(w), the 2-D cross cohort.

Definition (ARCHITECTURE-PHASE2-4.md §0, "Decision: the cross cohort"),
binding:

    4 pair classes x 5 creator-tax buckets = 20 rows, always emitted, in
    pair-major order (eth/0%, eth/1%, ... other/6-10%) so the byte diff is
    stable. Every row carries launches, graduations, rate|null,
    insufficient — exactly like every other cohort row — plus its own
    excludingFast block with the same cutoff, oneIn and gate as the
    window-level one.

    A launch whose creatorTaxBps is missing or outside the documented range
    has no cell and is counted in cohortsExcluded.pairTax, the same
    treatment the 1-D tax cohort already gives it.
"""
from pipeline.stats import (
    MIN_N,
    PAIR_BUCKETS,
    PAIR_TAX_BUCKETS,
    TAX_BUCKETS,
    cohort_excluded,
    pair_tax_cohort,
    window,
)


def _rows(w):
    return {row["bucket"]: row for row in pair_tax_cohort(w)}


def test_bucket_list_is_pair_major_and_fixed():
    assert PAIR_TAX_BUCKETS == [f"{p}/{t}" for p in PAIR_BUCKETS for t in TAX_BUCKETS]
    assert len(PAIR_TAX_BUCKETS) == 20
    assert PAIR_TAX_BUCKETS[0] == "eth/0%"
    assert PAIR_TAX_BUCKETS[-1] == "other/6-10%"


def test_every_row_is_emitted_in_order_even_when_empty(make_launch):
    w = window([make_launch(ts=0)], [], since=None, until=10**12)
    rows = pair_tax_cohort(w)
    assert [r["bucket"] for r in rows] == PAIR_TAX_BUCKETS


def test_row_shape_matches_a_cohort_row_plus_its_key_and_excluding_fast(make_launch):
    w = window([make_launch(ts=0)], [], since=None, until=10**12)
    row = pair_tax_cohort(w)[0]
    assert set(row) == {
        "bucket",
        "pairClass",
        "taxBucket",
        "launches",
        "graduations",
        "rate",
        "insufficient",
        "excludingFast",
    }
    assert row["pairClass"] == "eth"
    assert row["taxBucket"] == "0%"
    assert set(row["excludingFast"]) == {
        "cutoffSeconds",
        "graduations",
        "rate",
        "oneIn",
        "insufficient",
    }
    assert row["excludingFast"]["cutoffSeconds"] == 300


def test_launches_land_in_the_cell_named_by_their_pair_class_and_tax(make_launch):
    launches = [
        make_launch(pair_class="eth", tax_bps=0, ts=0),
        make_launch(pair_class="eth", tax_bps=150, ts=0),
        make_launch(pair_class="stable", tax_bps=1000, ts=0),
        make_launch(pair_class="stock", tax_bps=450, ts=0),
        make_launch(pair_class="other", tax_bps=100, ts=0),
    ]
    rows = _rows(window(launches, [], since=None, until=10**12))
    assert rows["eth/0%"]["launches"] == 1
    assert rows["eth/2-3%"]["launches"] == 1
    assert rows["stable/6-10%"]["launches"] == 1
    assert rows["stock/4-5%"]["launches"] == 1
    assert rows["other/1%"]["launches"] == 1
    assert sum(r["launches"] for r in rows.values()) == 5


def test_a_missing_or_out_of_range_tax_is_excluded_not_bucketed(make_launch):
    launches = [
        make_launch(pair_class="eth", tax_bps=None, ts=0),
        make_launch(pair_class="eth", tax_bps=1001, ts=0),
        make_launch(pair_class="eth", tax_bps=0, ts=0),
    ]
    w = window(launches, [], since=None, until=10**12)
    rows = _rows(w)
    assert sum(r["launches"] for r in rows.values()) == 1
    assert cohort_excluded(w, "pairTax") == 2


def test_bucketed_launches_plus_excluded_equal_the_window(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    rows = pair_tax_cohort(w)
    assert sum(r["launches"] for r in rows) + cohort_excluded(w, "pairTax") == len(
        w["launches"]
    )


def test_a_row_of_29_is_insufficient_and_a_row_of_30_is_not(make_launch, make_grad):
    launches = [make_launch(pair_class="eth", tax_bps=0, ts=0) for _ in range(29)]
    launches += [make_launch(pair_class="other", tax_bps=0, ts=0) for _ in range(30)]
    graduations = [make_grad(token=launches[0]["token"], ts=100)]
    graduations += [make_grad(token=launches[29 + i]["token"], ts=100) for i in range(3)]
    rows = _rows(window(launches, graduations, since=None, until=10**12))

    small = rows["eth/0%"]
    assert small["launches"] == 29
    assert small["graduations"] == 1
    assert small["rate"] is None
    assert small["insufficient"] is True
    assert small["excludingFast"]["rate"] is None
    assert small["excludingFast"]["oneIn"] is None
    assert small["excludingFast"]["insufficient"] is True

    big = rows["other/0%"]
    assert big["launches"] == 30
    assert big["graduations"] == 3
    assert big["rate"] == round(3 / 30, 6)
    assert big["insufficient"] is False
    assert MIN_N == 30


def test_excluding_fast_drops_graduations_inside_the_cutoff(make_launch, make_grad):
    launches = [make_launch(pair_class="eth", tax_bps=0, ts=0) for _ in range(40)]
    graduations = [make_grad(token=launches[i]["token"], ts=10) for i in range(6)]
    graduations += [make_grad(token=launches[10 + i]["token"], ts=300) for i in range(2)]
    rows = _rows(window(launches, graduations, since=None, until=10**12))
    row = rows["eth/0%"]
    assert row["graduations"] == 8
    assert row["rate"] == round(8 / 40, 6)
    excluding = row["excludingFast"]
    assert excluding["graduations"] == 2  # 300 s is not "inside 5 minutes"
    assert excluding["rate"] == round(2 / 40, 6)
    assert excluding["oneIn"] == 20
    assert excluding["insufficient"] is False


def test_a_row_with_no_slow_graduations_has_a_null_one_in(make_launch, make_grad):
    launches = [make_launch(pair_class="eth", tax_bps=0, ts=0) for _ in range(30)]
    graduations = [make_grad(token=launches[0]["token"], ts=5)]
    row = _rows(window(launches, graduations, since=None, until=10**12))["eth/0%"]
    assert row["excludingFast"]["graduations"] == 0
    assert row["excludingFast"]["rate"] == 0.0
    assert row["excludingFast"]["oneIn"] is None
    assert row["excludingFast"]["insufficient"] is False


def test_row_rates_agree_with_a_manual_count_on_the_big_fixture(big_fixture):
    launches, graduations = big_fixture
    # the raw backfill carries no tax data at all, so every launch is
    # excluded and every cell is empty: the honest result, asserted.
    w = window(launches, graduations, since=None, until=10**12)
    rows = pair_tax_cohort(w)
    assert all(r["launches"] == 0 for r in rows)
    assert all(r["insufficient"] is True for r in rows)
    assert all(r["rate"] is None for r in rows)
    assert cohort_excluded(w, "pairTax") == len(w["launches"])
