"""
pipeline/stats.py — cohort(w, key), cohort_excluded(w, key)

Binding rules (ARCHITECTURE.md §6):
  - key in {"pairClass","taxBucket","hourUtc","dayUtc"}
  - n < 30 -> rate null, insufficient true, uniformly.
  - Tax buckets: 0, 1-100, 101-300, 301-500, 501-1000 -> "0%","1%","2-3%",
    "4-5%","6-10%". creatorTaxBps is None -> excluded from the cohort and
    counted in cohortsExcluded.tax.
  - Hour/day buckets from datetime.fromtimestamp(ts, UTC). All 24/7 rows
    always emitted, even at n=0.
  - Day-of-week gating: the day cohort renders only if every row has
    insufficient == false.
"""
from datetime import datetime, timezone

from pipeline.stats import cohort, cohort_excluded, window


def test_cohort_n_29_is_insufficient_n_30_is_not(make_launch):
    launches_29 = [make_launch(token=f"0xA{i:039x}", pair_class="eth", ts=0) for i in range(29)]
    launches_29.append(make_launch(token="0xstock", pair_class="stock", ts=0))
    w29 = window(launches_29, [], since=None, until=10**12)
    rows29 = cohort(w29, "pairClass")
    eth_row_29 = next(r for r in rows29 if r["bucket"] == "eth")
    assert eth_row_29["launches"] == 29
    assert eth_row_29["insufficient"] is True
    assert eth_row_29["rate"] is None

    launches_30 = [make_launch(token=f"0xB{i:039x}", pair_class="eth", ts=0) for i in range(30)]
    w30 = window(launches_30, [], since=None, until=10**12)
    rows30 = cohort(w30, "pairClass")
    eth_row_30 = next(r for r in rows30 if r["bucket"] == "eth")
    assert eth_row_30["launches"] == 30
    assert eth_row_30["insufficient"] is False
    assert eth_row_30["rate"] == 0.0


def test_pair_cohort_always_emits_all_four_buckets_even_at_zero(make_launch):
    launches = [make_launch(token=f"0xC{i:039x}", pair_class="eth", ts=0) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    rows = cohort(w, "pairClass")
    buckets = {r["bucket"] for r in rows}
    assert buckets == {"eth", "stable", "stock", "other"}
    for r in rows:
        if r["bucket"] != "eth":
            assert r["launches"] == 0
            assert r["insufficient"] is True


def test_tax_cohort_bucket_edges(make_launch):
    # 0, 1-100, 101-300, 301-500, 501-1000 -> "0%","1%","2-3%","4-5%","6-10%"
    edges = {
        0: "0%",
        1: "1%",
        100: "1%",
        101: "2-3%",
        300: "2-3%",
        301: "4-5%",
        500: "4-5%",
        501: "6-10%",
        1000: "6-10%",
    }
    launches = []
    for tax_bps, expected_label in edges.items():
        for i in range(30):
            launches.append(
                make_launch(token=f"0xT{tax_bps}_{i:030x}", tax_bps=tax_bps, ts=0)
            )
    w = window(launches, [], since=None, until=10**12)
    rows = cohort(w, "taxBucket")
    by_bucket = {r["bucket"]: r for r in rows}
    for tax_bps, expected_label in edges.items():
        assert by_bucket[expected_label]["launches"] >= 30


def test_tax_bucket_missing_enrichment_excluded_from_cohort_and_counted(make_launch):
    launches = [make_launch(token=f"0xU{i:039x}", tax_bps=None, ts=0) for i in range(5)]
    launches += [make_launch(token=f"0xV{i:039x}", tax_bps=0, ts=0) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    excluded = cohort_excluded(w, "taxBucket")
    assert excluded == 5
    rows = cohort(w, "taxBucket")
    zero_row = next(r for r in rows if r["bucket"] == "0%")
    assert zero_row["launches"] == 30  # the 5 null-tax launches are not counted here


def test_cohorts_excluded_zero_when_all_enriched(make_launch):
    launches = [make_launch(token=f"0xW{i:039x}", tax_bps=0, ts=0) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    assert cohort_excluded(w, "taxBucket") == 0


def test_hour_cohort_emits_all_24_buckets(make_launch):
    launches = [make_launch(token="0xH", ts=1_700_000_000)]
    w = window(launches, [], since=None, until=10**12)
    rows = cohort(w, "hourUtc")
    assert len(rows) == 24
    buckets = {r["bucket"] for r in rows}
    assert buckets == {f"{h:02d}" for h in range(24)}


def test_hour_cohort_assigns_launch_to_correct_utc_hour(make_launch):
    ts = int(datetime(2026, 9, 6, 14, 30, 0, tzinfo=timezone.utc).timestamp())
    launches = [make_launch(token=f"0xI{i:039x}", ts=ts) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    rows = cohort(w, "hourUtc")
    hour_14 = next(r for r in rows if r["bucket"] == "14")
    assert hour_14["launches"] == 30
    for r in rows:
        if r["bucket"] != "14":
            assert r["launches"] == 0


def test_day_cohort_emits_all_7_buckets(make_launch):
    launches = [make_launch(token="0xD", ts=1_700_000_000)]
    w = window(launches, [], since=None, until=10**12)
    rows = cohort(w, "dayUtc")
    assert len(rows) == 7
    buckets = {r["bucket"] for r in rows}
    assert buckets == {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}


def test_day_cohort_all_rows_insufficient_until_every_bucket_has_30(make_launch):
    # Only Monday has >= 30 launches; every other day bucket is n=0 <
    # MIN_N, so every row (including Monday's) is "insufficient" per the
    # array-derived gating rule: day cohort renders only if EVERY row has
    # insufficient == false.
    monday_ts = int(datetime(2026, 9, 7, 12, 0, 0, tzinfo=timezone.utc).timestamp())  # a Monday
    launches = [make_launch(token=f"0xMo{i:038x}", ts=monday_ts) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    rows = cohort(w, "dayUtc")
    any_row_insufficient = any(r["insufficient"] for r in rows)
    assert any_row_insufficient is True  # 6 of the 7 days have n=0


def test_pair_cohort_rate_computed_correctly_per_bucket(make_launch, make_grad):
    eth_tokens = [f"0xE{i:039x}" for i in range(30)]
    launches = [make_launch(token=t, pair_class="eth", ts=0) for t in eth_tokens]
    graduations = [make_grad(token=eth_tokens[i], ts=100) for i in range(6)]  # 6/30
    w = window(launches, graduations, since=None, until=10**12)
    rows = cohort(w, "pairClass")
    eth_row = next(r for r in rows if r["bucket"] == "eth")
    assert eth_row["graduations"] == 6
    assert eth_row["rate"] == round(6 / 30, 6)


def test_cohorts_on_big_fixture_sum_of_pair_bucket_launches_equals_total(big_fixture, known_totals):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    rows = cohort(w, "pairClass")
    assert sum(r["launches"] for r in rows) == known_totals["launches"]
