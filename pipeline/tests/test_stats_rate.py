"""
pipeline/stats.py — rate(w) and rate_excluding_fast(w, cutoff)

Binding rules (ARCHITECTURE.md §6):
  - n is the bucket's launch count (denominator). n < 30 -> rate: null,
    insufficient: true.
  - rate = round(graduations / launches, 6). graduations = launches in the
    window that have a matching graduation record at any time.
  - oneIn = int(Decimal(1 / rate).quantize(0, ROUND_HALF_UP)), explicit
    half-up. null when graduations == 0 or insufficient.
  - Worked example from ARCHITECTURE.md: 174/23552 = 0.007388 -> 135.4 -> 135.
"""
from decimal import ROUND_HALF_UP, Decimal

from pipeline.stats import rate, rate_excluding_fast, window


# --- rate() on the real 23,552-launch / 535-matched-graduation fixture -----
def test_rate_on_big_fixture_equals_matched_over_launches(big_fixture, known_totals):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    r = rate(w)
    assert r["launches"] == known_totals["launches"]
    assert r["graduations"] == known_totals["matched"]
    assert r["rate"] == round(
        known_totals["matched"] / known_totals["launches"], 6
    )


def test_rate_excludes_orphan_graduations_from_numerator(big_fixture, known_totals):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    r = rate(w)
    # graduation EVENTS is 559; orphans (24) must never appear in the
    # numerator, so graduations counted must be strictly the matched 535,
    # never 559.
    assert r["graduations"] == known_totals["matched"]
    assert r["graduations"] != known_totals["graduation_events"]
    assert w["orphans"] == known_totals["orphans"]


def test_rate_not_insufficient_when_n_is_large(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    r = rate(w)
    assert r["insufficient"] is False


def test_rate_insufficient_when_n_below_30(make_launch):
    launches = [make_launch(ts=i) for i in range(29)]
    w = window(launches, [], since=None, until=10**12)
    r = rate(w)
    assert r["insufficient"] is True
    assert r["rate"] is None


def test_rate_sufficient_at_exactly_n_30(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    r = rate(w)
    assert r["insufficient"] is False
    assert r["rate"] == 0.0


def test_zero_graduation_window_renders_rate_zero_not_null(make_launch):
    launches = [make_launch(ts=i) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    r = rate(w)
    assert r["rate"] == 0.0
    assert r["insufficient"] is False


def test_zero_graduation_window_one_in_is_null(make_launch):
    launches = [make_launch(token=f"0x{i:040x}", ts=i) for i in range(30)]
    w = window(launches, [], since=None, until=10**12)
    r = rate_excluding_fast(w)
    assert r["graduations"] == 0
    assert r["oneIn"] is None


# --- rate_excluding_fast() cutoff behaviour, on the big fixture ------------
def test_rate_excluding_fast_denominator_matches_rate_denominator(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    assert rate(w)["launches"] == rate_excluding_fast(w)["launches"]


def test_rate_excluding_fast_numerator_matches_manually_computed_slow_count(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    launch_ts = {r["token"]: r["ts"] for r in launches}
    slow_count = 0
    for g in graduations:
        launch_t = launch_ts.get(g["token"])
        if launch_t is None:
            continue  # orphan, excluded from every rate
        if (g["ts"] - launch_t) >= 300:
            slow_count += 1
    result = rate_excluding_fast(w, cutoff=300)
    assert result["graduations"] == slow_count


def test_rate_excluding_fast_never_exceeds_plain_rate_graduations(big_fixture):
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    assert rate_excluding_fast(w, cutoff=300)["graduations"] <= rate(w)["graduations"]


def test_rate_excluding_fast_with_cutoff_zero_equals_plain_rate(big_fixture):
    # cutoff=0 means "fast" (< 0 seconds) can never happen, so nothing is
    # excluded and excludingFast collapses to the plain rate.
    launches, graduations = big_fixture
    w = window(launches, graduations, since=None, until=10**12)
    assert rate_excluding_fast(w, cutoff=0)["graduations"] == rate(w)["graduations"]


# --- oneIn rounding: explicit half-up, worked example from ARCHITECTURE.md -
def test_one_in_rounding_matches_documented_worked_example(make_launch, make_grad):
    # 174 slow graduations out of 23,552 launches -> rate 0.007388 -> 1/rate
    # = 135.35... -> half-up -> 135. Both 174 and 23552 are figures taken
    # directly from ARCHITECTURE.md's number.json sample, not invented here.
    n_launches = 23552
    n_slow_grads = 174
    launches = [make_launch(token=f"0xL{i:039x}", ts=0) for i in range(n_launches)]
    graduations = [
        make_grad(token=f"0xL{i:039x}", ts=1000) for i in range(n_slow_grads)
    ]  # all well past the 300s cutoff, ts delta = 1000
    w = window(launches, graduations, since=None, until=10**12)
    result = rate_excluding_fast(w, cutoff=300)
    assert result["rate"] == round(n_slow_grads / n_launches, 6)
    assert result["rate"] == 0.007388
    expected_one_in = int(
        Decimal(1 / result["rate"]).quantize(0, rounding=ROUND_HALF_UP)
    )
    assert expected_one_in == 135
    assert result["oneIn"] == 135


def test_one_in_uses_half_up_not_bankers_rounding(make_launch, make_grad):
    # Construct a rate whose reciprocal lands exactly on x.5 to distinguish
    # half-up (always rounds away from zero at .5) from Python's default
    # banker's rounding (rounds to even, which would round 2.5 -> 2).
    # rate = 0.4 -> 1/rate = 2.5 -> half-up -> 3 (banker's round would give 2).
    launches = [make_launch(token=f"0xM{i:039x}", ts=0) for i in range(30)]
    graduations = [make_grad(token=f"0xM{i:039x}", ts=1000) for i in range(12)]  # 12/30 = 0.4
    w = window(launches, graduations, since=None, until=10**12)
    result = rate_excluding_fast(w, cutoff=300)
    assert result["rate"] == 0.4
    assert result["oneIn"] == 3


def test_one_in_is_null_when_bucket_is_insufficient(make_launch, make_grad):
    launches = [make_launch(token=f"0xN{i:039x}", ts=0) for i in range(10)]  # n < 30
    graduations = [make_grad(token=f"0xN{i:039x}", ts=1000) for i in range(5)]
    w = window(launches, graduations, since=None, until=10**12)
    result = rate_excluding_fast(w, cutoff=300)
    assert result["insufficient"] is True
    assert result["oneIn"] is None
