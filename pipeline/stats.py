"""Pure stats functions. No I/O, no network, no clock reads except the
explicit crawled_at argument to build_number. Binding rules: ARCHITECTURE.md
section 6. This is the only place a METHOD.md definition lives in code.
"""
from __future__ import annotations

from bisect import bisect_left
from collections import Counter
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional, TypedDict

Launch = TypedDict(
    "Launch",
    {
        "token": str,
        "deployer": str,
        "pairToken": str,
        "pairClass": str,
        "creatorTaxBps": Optional[int],
        "block": int,
        "ts": int,
    },
)
Graduation = TypedDict("Graduation", {"token": str, "block": int, "ts": int})

MIN_N = 30
FAST_CUTOFF = 300  # seconds
DEFAULT_STALE_AFTER_SECONDS = 7200

FACTORY_ADDRESS = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"
CHAIN_ID = 4663
SCHEMA_VERSION = 2
DEFINITIONS_VERSION = "2026-09-06"

PAIR_BUCKETS = ["eth", "stable", "stock", "other"]
TAX_BUCKETS = ["0%", "1%", "2-3%", "4-5%", "6-10%"]
PAIR_TAX_BUCKETS = [f"{p}/{t}" for p in PAIR_BUCKETS for t in TAX_BUCKETS]
HOUR_BUCKETS = [f"{h:02d}" for h in range(24)]
DAY_BUCKETS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

_PERCENTILES = (10, 25, 50, 75, 90, 95)

# Fixed second marks of the time-to-graduation ladder. These are a
# definition, not a rendering choice: the live layer places a token by
# looking up the largest rung at or below its elapsed seconds, so moving one
# of these marks moves a published figure and needs a dated /method entry
# (CONSTRAINTS.md #9). ARCHITECTURE-PHASE2-4.md section 0.
LADDER_EDGES = (30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600)


def window(launches: list, graduations: list, since: Optional[int], until: int) -> dict:
    """Select launches with ts in the HALF-OPEN interval [since, until) and
    the graduations that match a launch inside that selection.

    Half-open is the binding convention (METHOD.md "Definitions"): a launch
    at exactly `until` belongs to the next window, so two adjacent windows
    partition the timeline without double-counting a launch at the seam.
    A graduation whose token has no launch anywhere in `launches` is an
    orphan; a graduation whose token launched outside this window is
    neither matched nor an orphan.
    """
    selected = [l for l in launches if (since is None or l["ts"] >= since) and l["ts"] < until]
    tokens_in_window = {l["token"] for l in selected}
    tokens_anywhere = {l["token"] for l in launches}

    grads_by_token: dict[str, dict] = {}
    orphans = 0
    for g in graduations:
        token = g["token"]
        if token in tokens_in_window:
            grads_by_token[token] = g
        elif token not in tokens_anywhere:
            orphans += 1

    return {
        "launches": selected,
        "grads_by_token": grads_by_token,
        "since": since,
        "until": until,
        "orphans": orphans,
    }


def rate(w: dict) -> dict:
    n = len(w["launches"])
    graduations = len(w["grads_by_token"])
    if n < MIN_N:
        return {"launches": n, "graduations": graduations, "rate": None, "insufficient": True}
    return {"launches": n, "graduations": graduations, "rate": round(graduations / n, 6), "insufficient": False}


def _ttg_deltas(w: dict) -> list[int]:
    launch_ts = {l["token"]: l["ts"] for l in w["launches"]}
    return [g["ts"] - launch_ts[token] for token, g in w["grads_by_token"].items()]


def _one_in(count: int, rate_value: Optional[float]) -> Optional[int]:
    """"1 in N" for a rate, rounded half up. Null when nothing was observed:
    there is no "1 in N" for a numerator of zero."""
    if not count or not rate_value:
        return None
    return int(Decimal(1 / rate_value).quantize(0, rounding=ROUND_HALF_UP))


def rate_excluding_fast(w: dict, cutoff: int = FAST_CUTOFF) -> dict:
    n = len(w["launches"])
    slow = sum(1 for delta in _ttg_deltas(w) if delta >= cutoff)
    if n < MIN_N:
        return {"launches": n, "graduations": slow, "rate": None, "oneIn": None, "insufficient": True}
    result_rate = round(slow / n, 6)
    return {
        "launches": n,
        "graduations": slow,
        "rate": result_rate,
        "oneIn": _one_in(slow, result_rate),
        "insufficient": False,
    }


def ttg_percentiles(w: dict) -> dict:
    deltas = sorted(_ttg_deltas(w))
    n = len(deltas)
    if n < MIN_N:
        result = {f"p{p}": None for p in _PERCENTILES}
        result["max"] = None
        result["n"] = n
        result["insufficient"] = True
        return result

    def nearest_rank(p: int) -> int:
        import math

        idx = math.ceil(p / 100 * n) - 1
        idx = max(0, min(n - 1, idx))
        return deltas[idx]

    result = {f"p{p}": nearest_rank(p) for p in _PERCENTILES}
    result["max"] = deltas[-1]
    result["n"] = n
    result["insufficient"] = False
    return result


def ttg_ladder(w: dict) -> list[dict]:
    """The monotone cumulative step table over LADDER_EDGES.

    `cumulative` counts matched graduations whose time to graduation is
    strictly less than the rung's mark -- the same convention as the fast
    cutoff ("graduated inside 5 minutes" is ttg < 300), so the rung at
    300 s is fastShares.under300Share and the rung at 60 s is
    under60Share by construction. The raw count is always published so a
    reader can check the share; the share itself is null for every rung
    below MIN_N, never 0.0 (CONSTRAINTS.md #4).

    A graduation slower than the last mark is counted in no rung, so the
    last rung's count can be below n. That is the observation, not a gap:
    the tail is published as `max` beside the percentiles.
    """
    deltas = sorted(_ttg_deltas(w))
    n = len(deltas)
    insufficient = n < MIN_N
    rungs = []
    for mark in LADDER_EDGES:
        cumulative = bisect_left(deltas, mark)
        rungs.append(
            {
                "atSeconds": mark,
                "cumulative": cumulative,
                "cumulativeShare": None if insufficient else round(cumulative / n, 6),
            }
        )
    return rungs


def ttg_block(w: dict) -> dict:
    """The published `ttg` object: percentiles plus the ladder, one gate."""
    return {**ttg_percentiles(w), "ladder": ttg_ladder(w)}


def fast_shares(w: dict) -> dict:
    """Shares of matched graduations under 300s / 60s, gated on MIN_N like
    every other rate. Below MIN_N -- including an empty population -- the
    shares are null with insufficient: true, never 0.0 (CONSTRAINTS.md #4:
    a 0.0 share reads as a measured finding)."""
    deltas = _ttg_deltas(w)
    n = len(deltas)
    if n < MIN_N:
        return {"under300Share": None, "under60Share": None, "n": n, "insufficient": True}
    under300 = sum(1 for d in deltas if d < 300)
    under60 = sum(1 for d in deltas if d < 60)
    return {
        "under300Share": round(under300 / n, 6),
        "under60Share": round(under60 / n, 6),
        "n": n,
        "insufficient": False,
    }


def _tax_bucket(bps: Optional[int]) -> Optional[str]:
    if bps is None:
        return None
    if bps == 0:
        return "0%"
    if 1 <= bps <= 100:
        return "1%"
    if 101 <= bps <= 300:
        return "2-3%"
    if 301 <= bps <= 500:
        return "4-5%"
    if 501 <= bps <= 1000:
        return "6-10%"
    return None  # out of documented range -- excluded like a missing value


def _bucket_key(launch: dict, key: str) -> Optional[str]:
    if key == "pairClass":
        return launch["pairClass"]
    if key == "taxBucket":
        return _tax_bucket(launch["creatorTaxBps"])
    if key == "pairTax":
        pair_class = launch["pairClass"]
        tax = _tax_bucket(launch["creatorTaxBps"])
        if pair_class not in PAIR_BUCKETS or tax is None:
            return None
        return f"{pair_class}/{tax}"
    if key == "hourUtc":
        return f"{datetime.fromtimestamp(launch['ts'], timezone.utc).hour:02d}"
    if key == "dayUtc":
        return DAY_BUCKETS[datetime.fromtimestamp(launch["ts"], timezone.utc).weekday()]
    raise ValueError(f"unknown cohort key: {key}")


def _bucket_list(key: str) -> list[str]:
    return {
        "pairClass": PAIR_BUCKETS,
        "taxBucket": TAX_BUCKETS,
        "pairTax": PAIR_TAX_BUCKETS,
        "hourUtc": HOUR_BUCKETS,
        "dayUtc": DAY_BUCKETS,
    }[key]


def cohort(w: dict, key: str) -> list[dict]:
    buckets = _bucket_list(key)
    launches_by_bucket: dict[str, list[dict]] = {b: [] for b in buckets}
    for l in w["launches"]:
        bucket = _bucket_key(l, key)
        if bucket is not None:
            launches_by_bucket[bucket].append(l)

    rows = []
    for bucket in buckets:
        members = launches_by_bucket[bucket]
        n = len(members)
        graduations = sum(1 for l in members if l["token"] in w["grads_by_token"])
        if n < MIN_N:
            rows.append({"bucket": bucket, "launches": n, "graduations": graduations, "rate": None, "insufficient": True})
        else:
            rows.append(
                {
                    "bucket": bucket,
                    "launches": n,
                    "graduations": graduations,
                    "rate": round(graduations / n, 6),
                    "insufficient": False,
                }
            )
    return rows


def cohort_excluded(w: dict, key: str) -> int:
    return sum(1 for l in w["launches"] if _bucket_key(l, key) is None)


def pair_tax_cohort(w: dict, cutoff: int = FAST_CUTOFF) -> list[dict]:
    """The 2-D cross cohort: 4 pair classes x 5 tax buckets, 20 rows, always
    emitted in pair-major order so the byte diff is stable.

    Every row is a cohort row (launches, graduations, rate|null,
    insufficient) plus the key it was cut on and its own excludingFast
    block, gated on the row's own denominator. A launch with no tax
    reading, or one outside the documented range, has no cell and is
    counted by cohort_excluded(w, "pairTax").

    ARCHITECTURE-PHASE2-4.md section 0, "Decision: the cross cohort".
    """
    launch_ts = {l["token"]: l["ts"] for l in w["launches"]}
    members: dict[str, list[dict]] = {b: [] for b in PAIR_TAX_BUCKETS}
    for l in w["launches"]:
        bucket = _bucket_key(l, "pairTax")
        if bucket is not None:
            members[bucket].append(l)

    rows = []
    for bucket in PAIR_TAX_BUCKETS:
        pair_class, tax_bucket = bucket.split("/", 1)
        cell = members[bucket]
        n = len(cell)
        deltas = [
            w["grads_by_token"][l["token"]]["ts"] - launch_ts[l["token"]]
            for l in cell
            if l["token"] in w["grads_by_token"]
        ]
        graduations = len(deltas)
        slow = sum(1 for d in deltas if d >= cutoff)

        if n < MIN_N:
            row_rate = None
            slow_rate = None
        else:
            row_rate = round(graduations / n, 6)
            slow_rate = round(slow / n, 6)

        rows.append(
            {
                "bucket": bucket,
                "pairClass": pair_class,
                "taxBucket": tax_bucket,
                "launches": n,
                "graduations": graduations,
                "rate": row_rate,
                "insufficient": n < MIN_N,
                "excludingFast": {
                    "cutoffSeconds": cutoff,
                    "graduations": slow,
                    "rate": slow_rate,
                    "oneIn": _one_in(slow, slow_rate),
                    "insufficient": n < MIN_N,
                },
            }
        )
    return rows


def deployers(w: dict) -> dict:
    counts = Counter(l["deployer"] for l in w["launches"])
    distinct = len(counts)
    total_launches = len(w["launches"])
    two_plus = sum(1 for c in counts.values() if c >= 2)
    from_10plus_launches = sum(c for c in counts.values() if c >= 10)

    histogram_buckets = [
        ("1", lambda c: c == 1),
        ("2-4", lambda c: 2 <= c <= 4),
        ("5-9", lambda c: 5 <= c <= 9),
        ("10-49", lambda c: 10 <= c <= 49),
        ("50+", lambda c: c >= 50),
    ]
    histogram = [
        {"bucket": label, "deployers": sum(1 for c in counts.values() if pred(c))}
        for label, pred in histogram_buckets
    ]

    # Each share is gated on its own denominator: launched2plusShare over
    # the deployer population, from10plusShare over the launch population.
    # Below MIN_N -- an empty population included -- the share is null, not
    # 0.0 (CONSTRAINTS.md #4).
    two_plus_share = round(two_plus / distinct, 6) if distinct >= MIN_N else None
    from_10plus_share = (
        round(from_10plus_launches / total_launches, 6) if total_launches >= MIN_N else None
    )

    return {
        "distinct": distinct,
        "launched2plusShare": two_plus_share,
        "from10plusShare": from_10plus_share,
        "insufficient": two_plus_share is None or from_10plus_share is None,
        "histogram": histogram,
    }


def _format_iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def first_indexed_at(launches: list) -> Optional[str]:
    """The earliest launch timestamp in the record, as an ISO-8601 Z string.

    Published beside `firstIndexedBlock` so a consumer can state coverage in
    hours without converting blocks to time -- a conversion METHOD.md
    forbids. Null when nothing is indexed yet.
    """
    if not launches:
        return None
    return _format_iso(min(l["ts"] for l in launches))


def _parse_iso(value: str) -> int:
    return int(datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def _window_block(launches: list, graduations: list, since: Optional[int], until: int, lower_bound: bool) -> dict:
    w = window(launches, graduations, since, until)
    plain = rate(w)
    excluding_fast = rate_excluding_fast(w)

    cohorts = {
        "pair": cohort(w, "pairClass"),
        "tax": cohort(w, "taxBucket"),
        "hour": cohort(w, "hourUtc"),
        "day": cohort(w, "dayUtc"),
        "pairTax": pair_tax_cohort(w),
    }
    cohorts_excluded = {
        "pair": cohort_excluded(w, "pairClass"),
        "tax": cohort_excluded(w, "taxBucket"),
        "hour": cohort_excluded(w, "hourUtc"),
        "day": cohort_excluded(w, "dayUtc"),
        "pairTax": cohort_excluded(w, "pairTax"),
    }

    return {
        "since": since,
        "until": until,
        "lowerBound": lower_bound,
        "launches": plain["launches"],
        "graduations": plain["graduations"],
        "rate": plain["rate"],
        "insufficient": plain["insufficient"],
        "orphans": w["orphans"],
        "excludingFast": {
            "cutoffSeconds": FAST_CUTOFF,
            "graduations": excluding_fast["graduations"],
            "rate": excluding_fast["rate"],
            "oneIn": excluding_fast["oneIn"],
            "insufficient": excluding_fast["insufficient"],
        },
        "fastShares": fast_shares(w),
        "ttg": ttg_block(w),
        "cohorts": cohorts,
        "cohortsExcluded": cohorts_excluded,
        "deployers": deployers(w),
    }


def build_number(launches: list, graduations: list, state: dict, crawled_at: str) -> dict:
    until = _parse_iso(crawled_at)
    since_24h = until - 86400

    # `stale` means exactly one thing: the run that generated this file
    # reported a failure since its last success, so it knows it is behind.
    # It is NOT wall-clock freshness -- a static file cannot age its own
    # field. Consumers compute age from `crawledAt` against
    # `staleAfterSeconds` at render time (METHOD.md "Freshness").
    last_run_at = state.get("lastRunAt")
    last_success_at = state.get("lastSuccessAt")
    stale = bool(state.get("consecutiveFailures"))
    if last_run_at and not last_success_at:
        stale = True
    elif last_run_at and last_success_at:
        stale = stale or _parse_iso(last_run_at) > _parse_iso(last_success_at)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "definitionsVersion": DEFINITIONS_VERSION,
        "crawledAt": crawled_at,
        "staleAfterSeconds": DEFAULT_STALE_AFTER_SECONDS,
        "stale": stale,
        "headBlock": state.get("lastIndexedBlock"),
        "firstIndexedBlock": state.get("firstIndexedBlock"),
        "firstIndexedAt": first_indexed_at(launches),
        "factory": FACTORY_ADDRESS,
        "chainId": CHAIN_ID,
        "h24": _window_block(launches, graduations, since_24h, until, lower_bound=True),
        "allTime": _window_block(launches, graduations, None, until, lower_bound=False),
    }
