"""
pipeline/vectors.py — the vector gate's Python half.

ARCHITECTURE-PHASE2-4.md §9, Gate 1: Python emits `tests/vectors/lookup.json`
from a frozen fixture; the Worker's vitest asserts its own lookup and text
code produces the identical object and the identical sentence. Both sides
diff the committed file in CI, so a drift fails both jobs.

These tests hold the Python half to three things:

  1. the file is a pure function of the frozen fixture (regeneration is a
     no-op, and the committed file is up to date);
  2. every Class A object in it carries `launches`, a `window` and the
     `crawledAt` it was computed at — the §3 binding rule, with no naked
     numbers anywhere;
  3. the boundary cases §9 names are actually present.
"""
import json
import re
from pathlib import Path

import pytest

from pipeline import vectors
from pipeline.canonical import canonical_dumps
from pipeline.stats import LADDER_EDGES

VECTORS_PATH = Path(__file__).resolve().parents[2] / "tests" / "vectors" / "lookup.json"
FIXTURE_NUMBER_PATH = VECTORS_PATH.parent / "fixture-number.json"

BANNED_WORDS = re.compile(
    r"\b(score|risk|odds|chance|likely|safe|rug|probab\w*|predict\w*|will)\b", re.I
)


@pytest.fixture(scope="module")
def built():
    return vectors.build()


def test_the_build_is_a_pure_function_of_the_frozen_fixture(built):
    assert canonical_dumps(vectors.build()) == canonical_dumps(built)


def test_the_committed_lookup_file_is_up_to_date(built):
    assert VECTORS_PATH.exists(), "run: python pipeline/vectors.py"
    assert VECTORS_PATH.read_text() == canonical_dumps(built)


def test_the_committed_fixture_number_file_is_up_to_date():
    assert FIXTURE_NUMBER_PATH.exists(), "run: python pipeline/vectors.py"
    assert FIXTURE_NUMBER_PATH.read_text() == canonical_dumps(vectors.build_fixture_number())


def test_the_fixture_number_is_the_backfill_fixture_with_synthetic_tax():
    number = vectors.build_fixture_number()
    assert number["schemaVersion"] == 2
    assert number["allTime"]["launches"] == 23552
    assert number["allTime"]["ttg"]["n"] == 535
    assert [r["atSeconds"] for r in number["allTime"]["ttg"]["ladder"]] == list(LADDER_EDGES)
    # the engineered cells that pin the n = 29 / n = 30 gate boundary
    rows = {r["bucket"]: r for r in number["allTime"]["cohorts"]["pairTax"]}
    assert rows["other/4-5%"]["launches"] == 29
    assert rows["other/4-5%"]["insufficient"] is True
    assert rows["other/6-10%"]["launches"] == 30
    assert rows["other/6-10%"]["insufficient"] is False


def test_the_vectors_name_the_file_they_were_cut_from(built):
    assert built["numberFile"] == "tests/vectors/fixture-number.json"
    assert built["crawledAt"] == vectors.build_fixture_number()["crawledAt"]
    assert built["ladderEdges"] == list(LADDER_EDGES)


def test_every_case_has_an_input_and_an_expected_object(built):
    assert len(built["cases"]) >= 15
    names = [c["name"] for c in built["cases"]]
    assert len(names) == len(set(names))
    for case in built["cases"]:
        assert set(case) == {"name", "why", "input", "expected"}
        assert set(case["input"]) == {
            "pairClass",
            "taxBps",
            "elapsedSeconds",
            "phase",
            "graduated",
            "indexed",
        }
        assert set(case["expected"]) == {"cohort", "placement", "text"}


def test_every_class_a_object_carries_n_a_window_and_a_crawled_at(built):
    for case in built["cases"]:
        cohort = case["expected"]["cohort"]
        assert cohort["crawledAt"] == built["crawledAt"]
        for key in ("h24", "allTime"):
            row = cohort[key]
            if row is None:
                assert cohort["key"]["taxBucket"] is None
                continue
            assert row["window"] == {"h24": "24h", "allTime": "allTime"}[key]
            assert isinstance(row["launches"], int)
            assert row["crawledAt"] == built["crawledAt"]
            if row["insufficient"]:
                assert row["rate"] is None
                assert row["excludingFast"]["rate"] is None
                assert row["excludingFast"]["oneIn"] is None

        placement = case["expected"]["placement"]
        if placement is not None:
            assert placement["crawledAt"] == built["crawledAt"]
            assert placement["window"] == "allTime"
            assert placement["reason"] in {"ok", "insufficient", "no_ladder", "before_first_step"}
            assert isinstance(placement["n"], int)


def test_placement_is_the_largest_rung_at_or_below_elapsed(built):
    ladder = {
        r["atSeconds"]: r
        for r in vectors.build_fixture_number()["allTime"]["ttg"]["ladder"]
    }
    for case in built["cases"]:
        placement = case["expected"]["placement"]
        if placement is None:
            assert case["input"]["indexed"] is False
            continue
        elapsed = case["input"]["elapsedSeconds"]
        below = [e for e in LADDER_EDGES if e <= elapsed]
        if not below:
            assert placement["rung"] is None
        else:
            assert placement["rung"] == ladder[below[-1]]


def test_no_case_prints_a_percentage_it_may_not_print(built):
    for case in built["cases"]:
        text = case["expected"]["text"]
        cohort = case["expected"]["cohort"]["allTime"]
        if cohort is None or cohort["insufficient"]:
            assert "%" not in text["headline"].split("·")[2]
        if case["expected"]["placement"] is None or case["expected"]["placement"]["insufficient"]:
            assert text["placement"] is None or "%" not in text["placement"]


def test_no_case_text_uses_a_banned_or_future_tense_word(built):
    for case in built["cases"]:
        for line in (case["expected"]["text"]["headline"], case["expected"]["text"]["placement"]):
            if line:
                assert not BANNED_WORDS.search(line), line


def test_the_boundaries_section_9_names_are_all_covered(built):
    names = {c["name"] for c in built["cases"]}
    for required in (
        "elapsed-on-ladder-mark",
        "elapsed-one-second-before-mark",
        "elapsed-past-max",
        "elapsed-below-first-rung",
        "cohort-n-29",
        "cohort-n-30",
        "tax-not-recorded",
        "tax-out-of-range",
        "graduated-token",
        "not-indexed-token",
    ):
        assert required in names, required


def test_a_null_tax_bucket_has_no_cell_and_says_so(built):
    case = next(c for c in built["cases"] if c["name"] == "tax-not-recorded")
    assert case["input"]["taxBps"] is None
    assert case["expected"]["cohort"]["key"]["taxBucket"] is None
    assert case["expected"]["cohort"]["allTime"] is None
    assert case["expected"]["cohort"]["h24"] is None
    assert "cohort not published" in case["expected"]["text"]["headline"]
    assert "tax not read" in case["expected"]["text"]["headline"]


def test_the_unindexed_case_has_no_elapsed_and_no_placement(built):
    case = next(c for c in built["cases"] if c["name"] == "not-indexed-token")
    assert case["input"]["indexed"] is False
    assert case["input"]["elapsedSeconds"] is None
    assert case["expected"]["placement"] is None
    assert case["expected"]["text"]["headline"].startswith("launch time not indexed")
    # the cohort still applies: eviction costs the timestamp, not the cohort
    assert case["expected"]["cohort"]["allTime"]["launches"] > 0


def test_the_graduated_case_reads_in_the_past_tense(built):
    case = next(c for c in built["cases"] if c["name"] == "graduated-token")
    assert case["input"]["graduated"] is True
    assert " · graduated · " in case["expected"]["text"]["headline"]


# --- the printing rules, ported from the Worker -----------------------------
# These pin the two ports most likely to drift silently, because both
# languages have a rounding rule of their own that disagrees with the other's.


def test_rate_text_rounds_the_way_tofixed_does_not_the_way_python_does():
    # 1.125 is exactly representable, so it is a true tie: JavaScript's
    # toFixed takes it up, Python's format() takes it to even.
    assert vectors.format_rate(0.01125, 1000) == "1.13%"
    assert f"{0.01125 * 100:.2f}%" == "1.12%"


def test_rate_text_takes_its_precision_from_the_sample():
    assert vectors.format_rate(0.0182, 999) == "1.8%"
    assert vectors.format_rate(0.0182, 1000) == "1.82%"


def test_an_insufficient_rate_prints_no_percentage_and_no_separator():
    assert vectors.rate_text(None, 3566, True) == "not enough data (n=3566)"
    assert vectors.rate_text(0.5, 29, False) == "not enough data (n=29)"


def test_counts_are_grouped_but_the_insufficient_n_is_not():
    # The asymmetry is the Worker's; a port that tidied it up would drift.
    assert vectors.format_count(3566) == "3,566"
    assert vectors.insufficient_text(3566) == "not enough data (n=3566)"


def test_js_round_takes_ties_up_where_python_takes_them_to_even():
    assert vectors._js_round(2.5) == 3
    assert round(2.5) == 2


def test_durations_print_the_way_the_worker_prints_them():
    assert vectors.format_duration(30) == "30 s"
    assert vectors.format_duration(120) == "2 min"
    assert vectors.format_duration(300) == "5 min"
    assert vectors.format_duration(3600) == "1 h"
    assert vectors.format_duration(3720) == "1 h 2 min"


def test_tax_buckets_print_with_an_en_dash_and_pair_classes_with_their_label():
    assert vectors.tax_label("2-3%") == "2\u20133%"
    assert vectors.tax_label("0%") == "0%"
    assert vectors.pair_label("stock") == "Tokenized stock"


def test_placement_reasons_separate_the_three_ways_to_have_no_rung(built):
    reasons = {
        c["name"]: c["expected"]["placement"]["reason"]
        for c in built["cases"]
        if c["expected"]["placement"] is not None
    }
    assert reasons["elapsed-below-first-rung"] == "before_first_step"
    assert reasons["elapsed-on-first-rung"] == "ok"
    # "younger than the first step" must never be worded as "not enough data"
    younger = next(
        c for c in built["cases"] if c["name"] == "elapsed-below-first-rung"
    )["expected"]["text"]["placement"]
    assert "younger than the first step" in younger
    assert "not enough" not in younger


def test_main_writes_both_files_and_check_agrees(tmp_path):
    out = tmp_path / "vectors"
    assert vectors.main(["--out-dir", str(out)]) == 0
    assert (out / "lookup.json").exists()
    assert (out / "fixture-number.json").exists()
    assert vectors.main(["--out-dir", str(out), "--check"]) == 0

    (out / "lookup.json").write_text(json.dumps({"cases": []}))
    assert vectors.main(["--out-dir", str(out), "--check"]) == 1
