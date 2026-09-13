"""
pipeline/stats.py — first_buy_block(): FIRSTBUY-BRIEF.md, 2026-09-13.

Pure function over (launches, firstbuys, state, until_ts). `firstbuys` is a
list of the two record kinds crawl.py writes to data/firstbuys/: one row per
launch-tx buy (`inLaunchTx: true`) and one row per first-outside buy
(`inLaunchTx: false`), keyed by `token`. No wallet address ever appears in
either kind (CONSTRAINTS.md #2) -- only `buyerIsDeployer`, which these tests
never need because first_buy_block does not read it at all.
"""
from pipeline.stats import PAIR_BUCKETS, TAX_BUCKETS, first_buy_block


def _launch(token, block=1000, ts=1_000_000, pair_class="eth", tax_bps=0):
    return {"token": token, "block": block, "ts": ts, "pairClass": pair_class, "creatorTaxBps": tax_bps}


def _outside(token, block, ts):
    return {"token": token, "inLaunchTx": False, "block": block, "ts": ts}


def _launch_tx(token, block, ts):
    return {"token": token, "inLaunchTx": True, "block": block, "ts": ts}


# --- indexedFromBlock null -> no population, never a crash -------------------
def test_indexed_from_block_null_yields_an_empty_population():
    result = first_buy_block([], [], {}, 2_000_000)
    assert result["indexedFromBlock"] is None
    row = result["cohorts"]["all"][0]
    assert row["n"] == 0
    assert row["insufficient"] is True


# --- population -----------------------------------------------------------
def test_population_excludes_launches_under_an_hour_old(make_launch):
    now_ts = 2_000_000
    old_enough = make_launch(block=1000, ts=now_ts - 3600)  # exactly the boundary: included
    too_new = make_launch(block=1000, ts=now_ts - 3599)  # one second short of an hour: excluded
    result = first_buy_block([old_enough, too_new], [], {"firstBuyIndexedFromBlock": 1000}, now_ts)
    assert result["cohorts"]["all"][0]["n"] == 1


def test_population_excludes_launches_before_indexed_from_block(make_launch):
    now_ts = 2_000_000
    before = make_launch(block=999, ts=now_ts - 4000)
    at_threshold = make_launch(block=1000, ts=now_ts - 4000)
    result = first_buy_block([before, at_threshold], [], {"firstBuyIndexedFromBlock": 1000}, now_ts)
    assert result["cohorts"]["all"][0]["n"] == 1


# --- bucket edges: same block beats delta, 1/3/5/6 land on the documented edges
def test_bucket_edges_and_same_block_priority():
    launch_ts = 1_000_000
    launch_block = 5000
    launches = []
    firstbuys = []
    edge_cases = [
        ("same-block", launch_block, launch_ts),  # different tx, same block: sameBlock wins over any delta
        ("delta1", launch_block + 1, launch_ts + 1),
        ("delta3", launch_block + 1, launch_ts + 3),
        ("delta5", launch_block + 1, launch_ts + 5),
        ("delta6", launch_block + 1, launch_ts + 6),
    ]
    for token, buy_block, buy_ts in edge_cases:
        launches.append(_launch(token, block=launch_block, ts=launch_ts))
        firstbuys.append(_outside(token, buy_block, buy_ts))
    launches.append(_launch("no-outside", block=launch_block, ts=launch_ts))

    until = launch_ts + 3600 + 1
    row = first_buy_block(launches, firstbuys, {"firstBuyIndexedFromBlock": launch_block}, until)["cohorts"]["all"][0]

    assert row["outside"] == {
        "sameBlock": 1, "within1s": 1, "within3s": 1, "within5s": 1, "after5s": 1, "none": 1,
    }


# --- cumulative shares, gated at n=30 -----------------------------------------
def test_cumulative_shares_at_min_n(make_launch):
    launches = [make_launch(block=1000, ts=1_000_000) for _ in range(30)]
    firstbuys = []
    groups = [
        (0, 3, lambda l: (l["block"], l["ts"])),          # sameBlock
        (3, 6, lambda l: (l["block"] + 1, l["ts"] + 1)),  # within1s
        (6, 9, lambda l: (l["block"] + 1, l["ts"] + 3)),  # within3s
        (9, 12, lambda l: (l["block"] + 1, l["ts"] + 5)), # within5s
        (12, 15, lambda l: (l["block"] + 1, l["ts"] + 6)),# after5s
        # 15..29 (15 launches): no outside record -> "none"
    ]
    for start, end, make_pos in groups:
        for l in launches[start:end]:
            block, ts = make_pos(l)
            firstbuys.append(_outside(l["token"], block, ts))
    for l in launches[:10]:
        firstbuys.append(_launch_tx(l["token"], l["block"], l["ts"]))

    until = launches[0]["ts"] + 3600 + 1
    row = first_buy_block(launches, firstbuys, {"firstBuyIndexedFromBlock": 1000}, until)["cohorts"]["all"][0]

    assert row["n"] == 30
    assert row["insufficient"] is False
    assert row["outside"] == {
        "sameBlock": 3, "within1s": 3, "within3s": 3, "within5s": 3, "after5s": 3, "none": 15,
    }
    assert row["sameBlockShare"] == round(3 / 30, 6)
    assert row["within1sShare"] == round(6 / 30, 6)
    assert row["within3sShare"] == round(9 / 30, 6)
    assert row["within5sShare"] == round(12 / 30, 6)
    assert row["noneShare"] == round(15 / 30, 6)
    assert row["launchTxBuy"] == 10
    assert row["launchTxBuyShare"] == round(10 / 30, 6)


# --- n < 30: counts always published, shares null, never 0.0 (CONSTRAINTS #4)
def test_below_min_n_shares_are_null_but_counts_still_shown(make_launch):
    launches = [make_launch(block=1000, ts=1_000_000) for _ in range(5)]
    firstbuys = [_outside(launches[0]["token"], launches[0]["block"], launches[0]["ts"])]
    until = launches[0]["ts"] + 3600 + 1

    row = first_buy_block(launches, firstbuys, {"firstBuyIndexedFromBlock": 1000}, until)["cohorts"]["all"][0]

    assert row["n"] == 5
    assert row["insufficient"] is True
    assert row["outside"]["sameBlock"] == 1
    assert row["outside"]["none"] == 4
    assert row["sameBlockShare"] is None
    assert row["within1sShare"] is None
    assert row["noneShare"] is None
    assert row["launchTxBuyShare"] is None


# --- taxBucket / pairClass cohorts -------------------------------------------
def test_tax_and_pair_cohorts_place_launches_in_the_right_bucket(make_launch):
    now_ts = 2_000_000
    l_eth = make_launch(block=1000, ts=now_ts - 4000, pair_class="eth", tax_bps=0)
    l_stable = make_launch(block=1000, ts=now_ts - 4000, pair_class="stable", tax_bps=300)
    result = first_buy_block([l_eth, l_stable], [], {"firstBuyIndexedFromBlock": 1000}, now_ts)

    pair_rows = {r["bucket"]: r["n"] for r in result["cohorts"]["pairClass"]}
    assert [r["bucket"] for r in result["cohorts"]["pairClass"]] == PAIR_BUCKETS
    assert pair_rows == {"eth": 1, "stable": 1, "stock": 0, "other": 0}

    tax_rows = {r["bucket"]: r["n"] for r in result["cohorts"]["taxBucket"]}
    assert [r["bucket"] for r in result["cohorts"]["taxBucket"]] == TAX_BUCKETS
    assert tax_rows == {"0%": 1, "1%": 0, "2-3%": 1, "4-5%": 0, "6-10%": 0}
