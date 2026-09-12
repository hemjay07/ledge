"""
pipeline/stats.py — outcomes(...), OUTCOMES-STATS-BRIEF.md / OUTCOMES.md
step 3.

Definition, binding:

    For each graduation with a pons pool, at each of the three marks (+1 h,
    +24 h, +7 d): priceAt is the CLOSE OF THE LAST HOUR BAR AT OR BEFORE the
    mark, never the nearest bar. No bar at or before the mark is `noTrade`,
    its own outcome -- never a price of 0, never dropped from n. A mark that
    has not yet elapsed for a graduation is absent from that mark's n
    entirely, not counted as noTrade. A pool with unknown decimals (null
    prices) is counted in `withoutPrice` and excluded from every mark's n
    and its medians. Cohorts (ttg bucket, pair token, tax band) are each
    independent, and every bucket is always emitted. Below n = 30 the whole
    mark row is `insufficient` and every quantile is null -- the same
    convention ttg_percentiles and cohort already use -- but the raw counts
    (n, noTrade, withoutPrice) are always published regardless.

Offline, fixtures only: no network, no chain reads. Fixtures are built by
hand here rather than via conftest's make_launch/make_grad, because pool
index rows and hour bars are a shape those fixtures know nothing about.
"""
import math

import pytest

from pipeline.canonical import canonical_dumps
from pipeline.stats import MIN_N, OUTCOME_MARKS, OUTCOME_TTG_BUCKETS, PAIR_BUCKETS, build_number, outcomes

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
UNKNOWN_PAIR = "0x" + "33" * 20
SQRT_PRICE_1_0 = 2**96  # sqrtPriceX96 for a 1:1 pool with equal decimals


def _token(i: int) -> str:
    return "0x" + format(0x1000 + i, "040x")


def _pool_id(i: int) -> str:
    return "0x" + format(0x9000 + i, "064x")


def _launch(i: int, pair_class="eth", tax_bps=0, ts=0):
    return {
        "token": _token(i),
        "deployer": "0x" + "d" * 40,
        "pairToken": ZERO_ADDRESS,
        "pairClass": pair_class,
        "creatorTaxBps": tax_bps,
        "block": 1,
        "ts": ts,
    }


def _grad(i: int, ts=0):
    return {"token": _token(i), "block": 1, "ts": ts}


def _pool_index_row(i: int, pair=ZERO_ADDRESS, sqrt=SQRT_PRICE_1_0):
    return {
        "pool": _pool_id(i),
        "token": _token(i),
        "pair": pair,
        "block": 1,
        "ts": 0,
        "sqrtPriceX96": sqrt,
        "tickSpacing": 60,
        "txHash": "0x" + "aa" * 32,
        "logIndex": i,
    }


def _bar(i: int, hour: str, close: str):
    return {
        "pool": _pool_id(i),
        "token": _token(i),
        "hour": hour,
        "open": close,
        "close": close,
        "high": close,
        "low": close,
        "swaps": 1,
        "volumeQuote": "0",
    }


def _population(n: int, close="2.0", hour="1970-01-01T00"):
    """n identical graduations, each with a 1:1-opening pool and one bar at
    `hour` closing at `close`. Opening price is always 1.0 (SQRT_PRICE_1_0),
    so changeAt = close - 1 exactly."""
    launches = [_launch(i) for i in range(n)]
    grads = [_grad(i) for i in range(n)]
    pool_index = [_pool_index_row(i) for i in range(n)]
    bars = [_bar(i, hour, close) for i in range(n)]
    return launches, grads, pool_index, bars


UNTIL_FAR_FUTURE = 10**7  # long past every mark for ts=0 anchors


def _run(launches, grads, pool_index, bars, until=UNTIL_FAR_FUTURE, pair_tokens=None):
    return outcomes(launches, grads, pool_index, bars, pair_tokens or {}, until)


def _pair_row(result, bucket="eth"):
    return next(r for r in result["cohorts"]["pair"] if r["bucket"] == bucket)


# --- shape -----------------------------------------------------------------
def test_every_bucket_is_emitted_even_when_empty():
    result = _run([], [], [], [])
    assert result["matched"] == 0
    assert [r["bucket"] for r in result["cohorts"]["pair"]] == PAIR_BUCKETS
    assert [r["bucket"] for r in result["cohorts"]["ttg"]] == OUTCOME_TTG_BUCKETS
    for row in result["cohorts"]["pair"]:
        assert set(row["marks"]) == set(OUTCOME_MARKS)
        for mark in row["marks"].values():
            assert mark == {
                "n": 0,
                "noTrade": 0,
                "noTradeShare": None,
                "median": None,
                "p25": None,
                "p75": None,
                "insufficient": True,
            }


# --- at or before, never nearest --------------------------------------------
def test_priceat_takes_the_bar_at_or_before_the_mark_not_the_nearest():
    """mark = +24h from ts=0, so the mark's hour is 1970-01-02T00. A bar
    5 hours earlier the day before is the only one at or before it; a bar
    1 hour after the mark is far nearer in raw time but must not be
    chosen."""
    launches = [_launch(i) for i in range(MIN_N)]
    grads = [_grad(i) for i in range(MIN_N)]
    pool_index = [_pool_index_row(i) for i in range(MIN_N)]
    bars = []
    for i in range(MIN_N):
        bars.append(_bar(i, "1970-01-01T00", "2.0"))   # at or before +24h: correct pick
        bars.append(_bar(i, "1970-01-02T01", "100.0"))  # nearer in time, after the mark

    result = _run(launches, grads, pool_index, bars)
    row = _pair_row(result)
    mark = row["marks"]["24h"]
    assert mark["n"] == MIN_N
    assert mark["noTrade"] == 0
    assert mark["median"] == pytest.approx(1.0)  # 2.0 / 1.0 - 1, not 100.0/1.0 - 1


# --- no bar at or before the mark is noTrade --------------------------------
def test_no_bar_before_the_mark_counts_as_no_trade_never_a_zero_price():
    launches = [_launch(i) for i in range(MIN_N)]
    grads = [_grad(i) for i in range(MIN_N)]
    pool_index = [_pool_index_row(i) for i in range(MIN_N)]
    # Every pool has no bars at all: no swap has happened since graduation.
    result = _run(launches, grads, pool_index, [])
    row = _pair_row(result)
    mark = row["marks"]["1h"]
    assert mark["n"] == MIN_N
    assert mark["noTrade"] == MIN_N
    assert mark["noTradeShare"] == 1.0
    assert mark["median"] is None
    assert mark["insufficient"] is False  # n itself clears MIN_N; there's simply no price data


# --- an unelapsed mark is absent from n, not noTrade ------------------------
def test_a_mark_not_yet_elapsed_is_not_counted_at_all():
    launches, grads, pool_index, bars = _population(MIN_N, close="2.0")
    # until is only 100s past the anchor: the 1h/24h/7d marks have not happened.
    result = _run(launches, grads, pool_index, bars, until=100)
    row = _pair_row(result)
    for label in OUTCOME_MARKS:
        mark = row["marks"][label]
        assert mark["n"] == 0
        assert mark["noTrade"] == 0
        assert mark["median"] is None


def test_a_mark_that_has_elapsed_for_some_but_not_others_only_counts_the_elapsed_ones():
    launches, grads, pool_index, bars = _population(MIN_N, close="2.0")
    # 2000s: past nothing (all marks are >= 3600s out) -- half the fixture
    # graduated "later" so its 1h mark hasn't happened yet from until's view.
    later = [_launch(i, ts=0) for i in range(MIN_N, MIN_N + 5)]
    later_grads = [_grad(i, ts=3000) for i in range(MIN_N, MIN_N + 5)]
    later_pool = [_pool_index_row(i) for i in range(MIN_N, MIN_N + 5)]
    later_bars = [_bar(i, "1970-01-01T00", "2.0") for i in range(MIN_N, MIN_N + 5)]

    result = _run(
        launches + later,
        grads + later_grads,
        pool_index + later_pool,
        bars + later_bars,
        until=3600,  # 1h mark has elapsed for ts=0 graduations, not for ts=3000 ones
    )
    row = _pair_row(result)
    assert row["marks"]["1h"]["n"] == MIN_N


# --- unknown decimals: withoutPrice, excluded from every mark's n ----------
def test_a_null_price_pool_is_counted_in_without_price_and_excluded_from_marks():
    priced_launches, priced_grads, priced_pool, priced_bars = _population(MIN_N, close="2.0")
    unpriced_launches = [_launch(MIN_N + i) for i in range(3)]
    unpriced_grads = [_grad(MIN_N + i) for i in range(3)]
    unpriced_pool = [_pool_index_row(MIN_N + i, pair=UNKNOWN_PAIR) for i in range(3)]
    unpriced_bars = [_bar(MIN_N + i, "1970-01-01T00", "2.0") for i in range(3)]

    result = _run(
        priced_launches + unpriced_launches,
        priced_grads + unpriced_grads,
        priced_pool + unpriced_pool,
        priced_bars + unpriced_bars,
    )
    row = _pair_row(result)
    assert row["graduations"] == MIN_N + 3
    assert row["withoutPrice"] == 3
    for label in OUTCOME_MARKS:
        assert row["marks"][label]["n"] == MIN_N  # the 3 unpriced never enter n


# --- n = 29 vs n = 30 --------------------------------------------------------
def test_n_29_is_insufficient_with_null_quantiles():
    launches, grads, pool_index, bars = _population(29, close="2.0")
    result = _run(launches, grads, pool_index, bars)
    mark = _pair_row(result)["marks"]["1h"]
    assert mark["n"] == 29
    assert mark["insufficient"] is True
    assert mark["median"] is None
    assert mark["p25"] is None
    assert mark["p75"] is None
    assert mark["noTradeShare"] is None


def test_n_30_prints_real_figures():
    launches, grads, pool_index, bars = _population(30, close="2.0")
    result = _run(launches, grads, pool_index, bars)
    mark = _pair_row(result)["marks"]["1h"]
    assert mark["n"] == 30
    assert mark["insufficient"] is False
    assert mark["median"] == pytest.approx(1.0)
    assert mark["noTradeShare"] == 0.0


# --- median / p25 / p75 against a hand-computed set -------------------------
def test_median_p25_p75_match_a_hand_computed_set():
    """changeAt values 0.00 .. 0.29 (30 of them, sorted ascending by
    construction). Nearest-rank, the same method ttg_percentiles uses:
    idx = ceil(p/100 * n) - 1. p50 -> idx 14 -> 0.14; p25 -> idx 7 -> 0.07;
    p75 -> idx 22 -> 0.22."""
    n = 30
    launches = [_launch(i) for i in range(n)]
    grads = [_grad(i) for i in range(n)]
    pool_index = [_pool_index_row(i) for i in range(n)]
    bars = [_bar(i, "1970-01-01T00", f"{1 + i / 100:.2f}") for i in range(n)]

    result = _run(launches, grads, pool_index, bars)
    mark = _pair_row(result)["marks"]["1h"]

    changes = sorted(i / 100 for i in range(n))

    def nearest_rank(p):
        idx = max(0, min(n - 1, math.ceil(p / 100 * n) - 1))
        return round(changes[idx], 6)

    assert mark["median"] == pytest.approx(nearest_rank(50))
    assert mark["p25"] == pytest.approx(nearest_rank(25))
    assert mark["p75"] == pytest.approx(nearest_rank(75))
    assert mark["median"] == pytest.approx(0.14)
    assert mark["p25"] == pytest.approx(0.07)
    assert mark["p75"] == pytest.approx(0.22)


# --- byte-stability ----------------------------------------------------------
def test_computing_twice_gives_an_identical_string():
    launches, grads, pool_index, bars = _population(30, close="1.5")
    a = canonical_dumps(_run(launches, grads, pool_index, bars))
    b = canonical_dumps(_run(launches, grads, pool_index, bars))
    assert a == b


def test_build_number_carries_outcomes_and_recomputes_byte_stable():
    launches, grads, pool_index, bars = _population(30, close="1.5")
    state = {
        "consecutiveFailures": 0,
        "lastRunAt": "2026-09-12T00:00:00Z",
        "lastSuccessAt": "2026-09-12T00:00:00Z",
        "firstIndexedBlock": 1,
        "lastIndexedBlock": 2,
    }
    crawled_at = "2026-09-12T00:00:00Z"
    first = canonical_dumps(
        build_number(launches, grads, state, crawled_at, pool_index=pool_index, pool_bars=bars)
    )
    second = canonical_dumps(
        build_number(launches, grads, state, crawled_at, pool_index=pool_index, pool_bars=bars)
    )
    assert first == second
    assert '"outcomes"' in first


def test_build_number_without_pool_data_still_emits_an_empty_outcomes_block():
    number = build_number([], [], {"consecutiveFailures": 0}, "2026-09-12T00:00:00Z")
    assert number["outcomes"]["matched"] == 0
    assert [r["bucket"] for r in number["outcomes"]["cohorts"]["pair"]] == PAIR_BUCKETS
