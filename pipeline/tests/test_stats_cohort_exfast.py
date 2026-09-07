"""Every cohort row carries its own excluding-fast figure.

The site leads with the excluding-fast rate. A cohort row that published only
the raw rate invited the reader to compare cohorts on a number the headline
says is contaminated -- which is how "stablecoin pairs graduate twice as
often" reached the front page, a difference that is entirely sub-cutoff
graduations and vanishes when they are removed.
"""
from datetime import datetime, timezone

from pipeline import stats


def _launch(token, ts, pair="0x0", tax=0, deployer="0xd"):
    return {
        "token": token,
        "deployer": deployer,
        "pairToken": pair,
        "pairClass": "eth" if pair == "0x0" else "stable",
        "creatorTaxBps": tax,
        "block": 1,
        "ts": ts,
        "txHash": "0x" + token[-2:] * 32,
        "logIndex": 0,
    }


def _window(launches, grads):
    return {
        "launches": launches,
        "grads_by_token": {g["token"]: g for g in grads},
        "since": None,
        "until": None,
    }


def _cohort_rows(pair_fast, pair_slow, n_per_bucket=40):
    """Two pair buckets with identical raw rates, differing only in how many
    of their graduations landed inside the cutoff."""
    launches, grads = [], []
    for i in range(n_per_bucket):
        eth = _launch(f"0xe{i:039x}"[:42], 1000, pair="0x0")
        stb = _launch(f"0xs{i:039x}".replace("s", "a")[:42], 1000, pair="0xstable")
        launches += [eth, stb]
    # same number of graduations in each bucket, different speeds
    for i in range(pair_fast):
        t = launches[2 * i]["token"]
        grads.append({"token": t, "ts": 1000 + 10, "block": 2})
    for i in range(pair_slow):
        t = launches[2 * i + 1]["token"]
        grads.append({"token": t, "ts": 1000 + 10_000, "block": 2})
    return _window(launches, grads)


def test_every_cohort_row_carries_an_excluding_fast_block():
    w = _cohort_rows(5, 5)
    for key in ("pairClass", "taxBucket", "hourUtc", "dayUtc"):
        for row in stats.cohort(w, key):
            assert "excludingFast" in row, f"{key}/{row['bucket']} has no excludingFast"
            ef = row["excludingFast"]
            assert set(ef) == {"cutoffSeconds", "graduations", "rate", "oneIn", "insufficient"}
            assert ef["cutoffSeconds"] == stats.FAST_CUTOFF


def test_two_buckets_with_one_raw_rate_are_told_apart_by_the_cutoff():
    """The defect this file exists for: identical raw rates, opposite meanings."""
    w = _cohort_rows(5, 5)
    rows = {r["bucket"]: r for r in stats.cohort(w, "pairClass")}
    eth, stable = rows["eth"], rows["stable"]
    assert eth["graduations"] == stable["graduations"] == 5
    assert eth["rate"] == stable["rate"]
    assert eth["excludingFast"]["graduations"] == 0
    assert stable["excludingFast"]["graduations"] == 5
    assert eth["excludingFast"]["rate"] == 0.0
    assert stable["excludingFast"]["rate"] > 0


def test_a_row_under_the_gate_publishes_no_excluding_fast_rate():
    w = _cohort_rows(1, 1, n_per_bucket=10)
    for row in stats.cohort(w, "pairClass"):
        assert row["insufficient"] is True
        assert row["rate"] is None
        assert row["excludingFast"]["rate"] is None
        assert row["excludingFast"]["insufficient"] is True
        # counts survive the gate; they are observations, not proportions
        assert isinstance(row["excludingFast"]["graduations"], int)


def test_cohort_excluding_fast_agrees_with_the_window_figure():
    """Summed over the pair cohort, the slow graduations equal the window's."""
    w = _cohort_rows(7, 3)
    rows = stats.cohort(w, "pairClass")
    assert sum(r["excludingFast"]["graduations"] for r in rows) == 3
