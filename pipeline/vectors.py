"""Emit the lookup vectors the live layer must reproduce.

ARCHITECTURE-PHASE2-4.md section 9, Gate 1. `pipeline/stats.py` is the only
place a statistic is defined; the Worker reads `number.json` and does table
lookups. This module freezes what those lookups must return: for a set of
(pairClass, taxBps, elapsedSeconds) inputs it writes the exact Class A
objects -- the cross-cohort row pair and the ladder placement -- and the
exact sentences assembled from them. The Worker's vitest asserts its own
code produces the identical objects and the identical strings, and CI
regenerates this file and diffs it. Neither side can drift alone.

Two files are written, both from the frozen 20-hour backfill capture and no
network at all:

  tests/vectors/fixture-number.json  the number.json the lookups are cut
                                     from (the Worker loads this, not live
                                     data, so a crawl cannot move a vector)
  tests/vectors/lookup.json          inputs -> expected objects and text

SYNTHETIC INPUTS, fixture-only, and deliberately visible here rather than
buried: the raw capture has block numbers only. Timestamps come from
`pipeline/tests/conftest.py`'s documented block-count conversion (production
timestamps come from block headers, per METHOD.md, never from a conversion),
and creator-tax readings, which the capture does not carry at all, are
assigned by the deterministic rule in `_synthetic_tax_bps` below. Neither
touches `data/`; nothing here is ever published as a measurement.
"""
from __future__ import annotations

import argparse
import importlib.util
import math
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from decimal import ROUND_HALF_UP, Decimal

from pipeline.canonical import canonical_dumps
from pipeline.stats import (
    DEFINITIONS_VERSION,
    LADDER_EDGES,
    PAIR_BUCKETS,
    _tax_bucket,
    build_number,
    format_iso,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFTEST_PATH = REPO_ROOT / "pipeline" / "tests" / "conftest.py"
DEFAULT_OUT_DIR = REPO_ROOT / "tests" / "vectors"
NUMBER_FILE_REF = "tests/vectors/fixture-number.json"

SEPARATOR = " \u00b7 "

PAIR_LABELS = {
    "eth": "ETH",
    "stable": "Stablecoin",
    "stock": "Tokenized stock",
    "other": "Other",
}


def _conftest():
    """The fixture converter, imported as a module rather than copied.

    The synthetic timestamp and dedupe-key rules live in one place and this
    file uses them; a change there changes the vectors, which is correct.
    """
    spec = importlib.util.spec_from_file_location("ledge_fixture_conftest", CONFTEST_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _synthetic_tax_bps(index: int, pair_class: str, other_rank: int | None) -> int | None:
    """FIXTURE-ONLY creator-tax assignment. Deterministic, never published.

    Engineered so the vectors pin the gate boundary exactly: the first 29
    `other`-paired launches form a cell of 29 (insufficient) and the next 30
    form a cell of 30 (sufficient). Every remaining launch takes a bucket
    from its position, one in ten with no reading at all so the "no cell"
    path is covered too.
    """
    if pair_class == "other" and other_rank is not None:
        if other_rank < 29:
            return 400  # -> "4-5%", a cell of exactly 29
        if other_rank < 59:
            return 600  # -> "6-10%", a cell of exactly 30
    slot = index % 10
    if slot == 0:
        return None  # no reading: excluded from the cross cohort
    if slot <= 3:
        return 0
    if slot <= 6:
        return 100
    return 300


def build_fixture_number() -> dict:
    """number.json built from the frozen backfill capture. No network."""
    conftest = _conftest()
    raw = __import__("json").loads(conftest.BACKFILL_FIXTURE_PATH.read_text())

    launches = [conftest._launch_record(tok, info) for tok, info in raw["launches"].items()]
    graduations = [
        conftest._grad_record(tok, info, raw["launches"]) for tok, info in raw["grads"].items()
    ]
    launches.sort(key=lambda r: (r["block"], r["token"]))
    graduations.sort(key=lambda r: (r["block"], r["token"]))

    other_rank = 0
    for index, launch in enumerate(launches):
        rank = None
        if launch["pairClass"] == "other":
            rank = other_rank
            other_rank += 1
        launch["creatorTaxBps"] = _synthetic_tax_bps(index, launch["pairClass"], rank)

    until = max(r["ts"] for r in launches + graduations) + 1
    crawled_at = format_iso(until)
    state = {
        "consecutiveFailures": 0,
        "lastRunAt": crawled_at,
        "lastSuccessAt": crawled_at,
        "firstIndexedBlock": min(r["block"] for r in launches),
        "lastIndexedBlock": raw["head"],
    }
    return build_number(launches, graduations, state, crawled_at)


# --- the lookups the Worker must reproduce ----------------------------------
# Everything below is a PORT, not a design. `worker/src/text.ts` is the one
# text builder (ARCHITECTURE-PHASE2-4 section 8) and it is already wired into
# the API, the /t shell, the death card and the Telegram bot; `format.ts`
# holds the printing rules, themselves a port of site/lib/format-core.mjs.
# This module reproduces those rules in Python so the two sides can be diffed.
# Where the wording below looks arbitrary it is not: it is what the Worker
# already says, character for character. If the Worker's wording changes, this
# file must change with it and the gate fails until it does -- which is the
# point of the gate.

WINDOW_LABEL = {"h24": "24h", "allTime": "allTime"}
INSUFFICIENT_BELOW = 30


def _js_round(value: float) -> int:
    """JavaScript's Math.round: ties go up, toward +infinity. Python's round()
    goes to even, which disagrees at every .5 -- so it is not used here."""
    return math.floor(value + 0.5)


def format_count(value: int) -> str:
    """Number.prototype.toLocaleString("en-US"): grouped by thousands."""
    return f"{value:,}"


def _decimals_for(n: int) -> int:
    """METHOD.md "Precision": two decimals at n >= 1,000, one below."""
    return 2 if n >= 1000 else 1


def format_rate(rate: float, n: int) -> str:
    """Number.prototype.toFixed: half-up on the exact binary value of the
    double. Python's format() rounds half to even and would disagree on a
    value like 1.125, so the rounding is done through Decimal instead."""
    quantum = Decimal(1).scaleb(-_decimals_for(n))
    fixed = Decimal(rate * 100).quantize(quantum, rounding=ROUND_HALF_UP)
    return f"{fixed}%"


def insufficient_text(n: int) -> str:
    """Note: no thousands separator here, and one in the sufficient branch --
    that asymmetry is the Worker's, and a port that tidied it up would drift."""
    return f"not enough data (n={n})"


def is_insufficient(rate: float | None, n: int, insufficient: bool) -> bool:
    return insufficient or rate is None or not n >= INSUFFICIENT_BELOW


def rate_text(rate: float | None, n: int, insufficient: bool) -> str:
    if is_insufficient(rate, n, insufficient):
        return insufficient_text(n)
    return format_rate(rate, n)


def format_duration(seconds: int) -> str:
    """"41 s", "4 min", "1 h 2 min"."""
    s = max(0, _js_round(seconds))
    if s < 90:
        return f"{s} s"
    if s < 3600:
        return f"{_js_round(s / 60)} min"
    h = s // 3600
    m = _js_round((s - h * 3600) / 60)
    if m == 60:
        return f"{h + 1} h"
    return f"{h} h" if m == 0 else f"{h} h {m} min"


def minute_of(elapsed_seconds: int) -> int:
    return max(0, elapsed_seconds) // 60


def pair_label(pair_class: str) -> str:
    return PAIR_LABELS.get(pair_class, pair_class)


def tax_label(bucket: str) -> str:
    """Tax buckets are stored as "2-3%" and printed with an en dash."""
    return bucket.replace("-", "\u2013", 1)


def _cohort_side(row: dict, window_name: str, crawled_at: str) -> dict:
    """One window of a cross-cohort cell, in the API's Class A shape.

    Every field the response rule demands is present: the denominator, the
    window it was cut over, and the time it was measured.
    """
    return {
        "window": WINDOW_LABEL[window_name],
        "crawledAt": crawled_at,
        "launches": row["launches"],
        "graduations": row["graduations"],
        "rate": row["rate"],
        "insufficient": row["insufficient"],
        "excludingFast": dict(row["excludingFast"]),
    }


def cohort_lookup(number: dict, pair_class: str, tax_bps: int | None) -> dict:
    """The cross-cohort object for a token's configuration.

    A configuration with no readable tax names no cell, and both windows are
    null -- the null `taxBucket` in the key says why. Nothing is substituted
    from a neighbouring cell.
    """
    tax_bucket = _tax_bucket(tax_bps)
    crawled_at = number["crawledAt"]
    result = {
        "crawledAt": crawled_at,
        "definitionsVersion": number["definitionsVersion"],
        "key": {"pairClass": pair_class, "taxBucket": tax_bucket},
        "h24": None,
        "allTime": None,
    }
    if tax_bucket is None or pair_class not in PAIR_BUCKETS:
        return result

    bucket = f"{pair_class}/{tax_bucket}"
    for window_name in ("h24", "allTime"):
        row = next(
            (r for r in number[window_name]["cohorts"]["pairTax"] if r["bucket"] == bucket),
            None,
        )
        if row is not None:
            result[window_name] = _cohort_side(row, window_name, crawled_at)
    return result


def placement_lookup(number: dict, elapsed_seconds: int | None, window_name: str = "allTime") -> dict | None:
    """Where an elapsed time falls on the ladder. A lookup, never a division.

    Null when the launch time is not indexed: there is nothing to place, and
    the response says so in its notice instead (section 3, `not_indexed`).

    `reason` names why a placement has no rung, so "the table is not
    published yet" is never reported as "not enough graduations" -- a
    different, and untrue, statement.
    """
    if elapsed_seconds is None:
        return None
    ttg = number[window_name]["ttg"]
    base = {
        "crawledAt": number["crawledAt"],
        "window": WINDOW_LABEL[window_name],
        "elapsedSeconds": elapsed_seconds,
        "n": ttg["n"],
    }
    ladder = ttg.get("ladder")
    if not ladder:
        return {**base, "rung": None, "insufficient": True, "reason": "no_ladder"}
    if ttg["insufficient"]:
        return {**base, "rung": None, "insufficient": True, "reason": "insufficient"}

    rung = None
    for candidate in ladder:
        if candidate["atSeconds"] <= elapsed_seconds:
            rung = dict(candidate)
    if rung is None:
        return {**base, "rung": None, "insufficient": False, "reason": "before_first_step"}
    if rung["cumulativeShare"] is None:
        return {**base, "rung": rung, "insufficient": True, "reason": "insufficient"}
    return {**base, "rung": rung, "insufficient": False, "reason": "ok"}


# --- the sentences ----------------------------------------------------------
def outcome_word(elapsed_seconds: int | None, phase: int, graduated: bool, observed_max: int | None) -> str:
    """The outcome word, in the past tense, about one token.

    "died" is said only where the outcome is settled: still on the curve, no
    graduation seen, and older than the longest time to graduation ever
    measured in the published window. Anything else is "on the curve", which
    describes rather than forecasts.
    """
    if graduated or phase == 2:
        return "graduated"
    if elapsed_seconds is None or observed_max is None:
        return "on the curve"
    if phase != 0:
        return "on the curve"
    return "died" if elapsed_seconds > observed_max else "on the curve"


def headline(number: dict, case_input: dict, cohort: dict) -> str:
    """The death-card line and the og:title of /t/{address}:

        minute 14 . died . cohort 1.2% (n=156) . ETH . 2-3%
    """
    elapsed = case_input["elapsedSeconds"]
    when = "launch time not indexed" if elapsed is None else f"minute {minute_of(elapsed)}"

    side = cohort["allTime"] or cohort["h24"]
    if side is None:
        cohort_part = "cohort not published"
    else:
        printed = rate_text(side["rate"], side["launches"], side["insufficient"])
        suffix = (
            ""
            if is_insufficient(side["rate"], side["launches"], side["insufficient"])
            else f" (n={format_count(side['launches'])})"
        )
        cohort_part = f"cohort {printed}{suffix}"

    tax_bucket = cohort["key"]["taxBucket"]
    config_part = SEPARATOR.join(
        [
            pair_label(case_input["pairClass"]),
            "tax not read" if tax_bucket is None else tax_label(tax_bucket),
        ]
    )
    return SEPARATOR.join(
        [
            when,
            outcome_word(
                elapsed,
                case_input["phase"],
                case_input["graduated"],
                number["allTime"]["ttg"]["max"],
            ),
            cohort_part,
            config_part,
        ]
    )


def placement_sentence(placement: dict | None) -> str | None:
    """Where the token sits on the published table of graduation times. The
    share is stats.py's, copied; only the wording is chosen here."""
    if placement is None:
        return None
    if placement["reason"] == "no_ladder":
        return "The table of graduation times is not published yet, so this launch is not placed on it."
    if placement["reason"] == "insufficient" or placement["rung"] is None:
        if placement["reason"] == "before_first_step":
            return (
                "This launch is younger than the first step of the published table "
                f"(n={format_count(placement['n'])})."
            )
        return f"Not enough graduations to place this launch (n={format_count(placement['n'])})."
    share = placement["rung"]["cumulativeShare"]
    if share is None:
        return f"Not enough graduations to place this launch (n={format_count(placement['n'])})."
    return (
        f"By {format_duration(placement['rung']['atSeconds'])}, "
        f"{rate_text(share, placement['n'], False)} of the {format_count(placement['n'])} "
        "graduations measured in this window had already happened."
    )


def _case(number: dict, name: str, why: str, **case_input) -> dict:
    case_input.setdefault("phase", 0)
    case_input.setdefault("graduated", False)
    case_input.setdefault("indexed", True)
    ordered = {
        "pairClass": case_input["pairClass"],
        "taxBps": case_input["taxBps"],
        "elapsedSeconds": case_input["elapsedSeconds"],
        "phase": case_input["phase"],
        "graduated": case_input["graduated"],
        "indexed": case_input["indexed"],
    }
    cohort = cohort_lookup(number, ordered["pairClass"], ordered["taxBps"])
    placement = placement_lookup(number, ordered["elapsedSeconds"])
    return {
        "name": name,
        "why": why,
        "input": ordered,
        "expected": {
            "cohort": cohort,
            "placement": placement,
            "text": {
                "headline": headline(number, ordered, cohort),
                "placement": placement_sentence(placement),
            },
        },
    }


def build_cases(number: dict) -> list[dict]:
    """The boundaries that matter, section 9, one case each."""
    ttg_max = number["allTime"]["ttg"]["max"]
    cases = [
        _case(number, "elapsed-below-first-rung", "under the ladder's first mark: no rung yet",
              pairClass="eth", taxBps=0, elapsedSeconds=0),
        _case(number, "elapsed-on-first-rung", "exactly the first mark",
              pairClass="eth", taxBps=0, elapsedSeconds=LADDER_EDGES[0]),
        _case(number, "elapsed-one-second-before-mark", "one second under a ladder mark stays on the rung below",
              pairClass="eth", taxBps=0, elapsedSeconds=299),
        _case(number, "elapsed-on-ladder-mark", "exactly the 300 s mark, the fast cutoff",
              pairClass="eth", taxBps=0, elapsedSeconds=300),
        _case(number, "elapsed-between-rungs", "between two marks: the lower rung holds",
              pairClass="eth", taxBps=100, elapsedSeconds=811),
        _case(number, "elapsed-on-last-rung", "exactly the last mark",
              pairClass="eth", taxBps=0, elapsedSeconds=LADDER_EDGES[-1]),
        _case(number, "elapsed-past-last-rung", "past the last mark: the top rung still holds",
              pairClass="eth", taxBps=0, elapsedSeconds=LADDER_EDGES[-1] + 1),
        _case(number, "elapsed-past-max", "longer than any graduation measured in the window",
              pairClass="eth", taxBps=0, elapsedSeconds=ttg_max + 1),
        _case(number, "cohort-n-29", "a cell of 29: under the gate, no rate may be printed",
              pairClass="other", taxBps=400, elapsedSeconds=600),
        _case(number, "cohort-n-30", "a cell of exactly 30: the gate opens",
              pairClass="other", taxBps=600, elapsedSeconds=600),
        _case(number, "cohort-empty-cell", "a cell nothing landed in",
              pairClass="stable", taxBps=0, elapsedSeconds=600),
        _case(number, "cohort-unobserved-pair-class", "a pair class with no launches in the window",
              pairClass="stock", taxBps=300, elapsedSeconds=600),
        _case(number, "tax-not-recorded", "no tax reading: no cell, and the card says so",
              pairClass="eth", taxBps=None, elapsedSeconds=600),
        _case(number, "tax-out-of-range", "a tax outside the documented range is not bucketed",
              pairClass="eth", taxBps=1001, elapsedSeconds=600),
        _case(number, "graduated-token", "an outcome already observed, in the past tense",
              pairClass="eth", taxBps=300, elapsedSeconds=96, phase=2, graduated=True),
        _case(number, "not-indexed-token", "evicted from the live window: the cohort survives, the clock does not",
              pairClass="eth", taxBps=300, elapsedSeconds=None, indexed=False),
    ]
    for bps in (0, 1, 100, 101, 300, 301, 500, 501, 1000):
        cases.append(
            _case(number, f"tax-bucket-boundary-{bps}", f"{bps} bps sits in one bucket and one only",
                  pairClass="eth", taxBps=bps, elapsedSeconds=600)
        )
    return cases


def build() -> dict:
    number = build_fixture_number()
    return {
        "schemaVersion": 1,
        "generatedBy": "pipeline/vectors.py",
        "source": "pipeline/tests/fixture-backfill-20h.json (synthetic ts and tax, fixture-only)",
        "numberFile": NUMBER_FILE_REF,
        "definitionsVersion": DEFINITIONS_VERSION,
        "crawledAt": number["crawledAt"],
        "ladderEdges": list(LADDER_EDGES),
        "cases": build_cases(number),
    }


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit the live layer's lookup vectors.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--check", action="store_true", help="diff against the committed files, exit 1 on mismatch")
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir)
    written = {
        out_dir / "fixture-number.json": canonical_dumps(build_fixture_number()),
        out_dir / "lookup.json": canonical_dumps(build()),
    }

    if args.check:
        for path, expected in written.items():
            if not path.exists():
                print(f"vectors --check: {path} does not exist", file=sys.stderr)
                return 1
            if path.read_text() != expected:
                print(f"vectors --check: {path} is out of date", file=sys.stderr)
                return 1
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    for path, content in written.items():
        path.write_text(content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
