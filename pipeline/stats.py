"""Pure stats functions. No I/O, no network, no clock reads except the
explicit crawled_at argument to build_number. Binding rules: ARCHITECTURE.md
section 6. This is the only place a METHOD.md definition lives in code.
"""
from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections import Counter
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional, TypedDict

from pipeline.pool import quote_per_token

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

# Bucket edges of the time-to-graduation histogram, in seconds, each about
# double the last. Like LADDER_EDGES these are a definition and not a
# rendering choice: moving one moves a published figure and needs a dated
# /method entry (CONSTRAINTS.md #9).
#
# Doubling is what makes the shape legible. Graduation times run from under a
# second to over four days, so equal-width buckets put 99% of the record in
# the first bar and say nothing. On a doubling scale the distribution is
# visibly TWO populations with a trough between them: measured 2026-09-10 over
# 2,465 graduations, 158 landed under two seconds, 96 in the 2-5s bucket, and
# the broad hump peaked at 285 in 160-320s.
#
# The first edge is 2 rather than 1 because a launch and a graduation in the
# same block have a difference of zero, and a bucket that cannot separate zero
# from one second would hide the very thing this histogram exists to show.
HISTOGRAM_EDGES = (0, 2, 5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240)

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# OUTCOMES.md step 3: the three marks after a graduation, in seconds. Named
# rather than a bare list so the published block is self-describing; moving
# one is a change to a published figure and needs a dated METHOD.md entry,
# exactly like LADDER_EDGES and HISTOGRAM_EDGES above.
OUTCOME_MARKS = {"1h": 3600, "24h": 86400, "7d": 604800}

# Reuses the descriptive time-to-graduation marks already on /graduated
# (site/components/Graduated.tsx's GRADUATED_IN_OPTIONS: under 10 s,
# 10 s - 5 min, over 5 min) rather than inventing new edges, per
# OUTCOMES-STATS-BRIEF.md.
OUTCOME_TTG_BUCKETS = ["u10", "mid", "over"]


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


def ttg_histogram(w: dict) -> list[dict]:
    """The distribution of times to graduation, in doubling buckets.

    Every bucket is half-open `[fromSeconds, toSeconds)`, so the buckets
    partition the record without double-counting a graduation that lands
    exactly on an edge -- the same half-open convention the windows use. The
    final bucket has `toSeconds: None` and holds everything past the last
    edge, so the counts always sum to n and no graduation falls outside the
    table.

    The raw count is always published. The share is null for every bucket
    whenever n is below MIN_N, never 0.0 (CONSTRAINTS.md #4), and the count is
    still there to be checked against.

    This is a description of a population and nothing more. It says how long
    graduations took; it does not say which of them were real, and no bucket
    is a label. CONSTRAINTS.md #6 binds: the 5-minute mark is a descriptive
    threshold, never a definition of "rigged", and the same is true of every
    edge here.
    """
    deltas = sorted(_ttg_deltas(w))
    n = len(deltas)
    insufficient = n < MIN_N
    rows = []
    edges = list(HISTOGRAM_EDGES) + [None]
    for i, low in enumerate(HISTOGRAM_EDGES):
        high = edges[i + 1]
        count = (
            len(deltas) - bisect_left(deltas, low)
            if high is None
            else bisect_left(deltas, high) - bisect_left(deltas, low)
        )
        rows.append(
            {
                "fromSeconds": low,
                "toSeconds": high,
                "graduations": count,
                "share": None if insufficient else round(count / n, 6),
            }
        )
    return rows


def ttg_block(w: dict) -> dict:
    """The published `ttg` object: percentiles, the ladder and the histogram,
    one gate over all three."""
    return {**ttg_percentiles(w), "ladder": ttg_ladder(w), "histogram": ttg_histogram(w)}


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


def cohort(w: dict, key: str, cutoff: int = FAST_CUTOFF) -> list[dict]:
    """One row per bucket, each carrying its raw rate and its own
    excluding-fast rate.

    Both, because the page leads with the excluding-fast figure: a row that
    published only the raw rate invited a comparison across buckets on the
    number the headline calls contaminated. Measured on the record of
    2026-09-07, the pair-token buckets read 1.64% / 2.37% / 3.17% raw and
    0.71% / 0.71% / 0.73% once graduations inside the cutoff are removed --
    one ordering is a finding about pair tokens, the other is a finding
    about who fills their own curve.
    """
    buckets = _bucket_list(key)
    launch_ts = {l["token"]: l["ts"] for l in w["launches"]}
    launches_by_bucket: dict[str, list[dict]] = {b: [] for b in buckets}
    for l in w["launches"]:
        bucket = _bucket_key(l, key)
        if bucket is not None:
            launches_by_bucket[bucket].append(l)

    rows = []
    for bucket in buckets:
        members = launches_by_bucket[bucket]
        n = len(members)
        deltas = [
            w["grads_by_token"][l["token"]]["ts"] - launch_ts[l["token"]]
            for l in members
            if l["token"] in w["grads_by_token"]
        ]
        graduations = len(deltas)
        slow = sum(1 for d in deltas if d >= cutoff)
        insufficient = n < MIN_N
        rate = None if insufficient else round(graduations / n, 6)
        slow_rate = None if insufficient else round(slow / n, 6)
        rows.append(
            {
                "bucket": bucket,
                "launches": n,
                "graduations": graduations,
                "rate": rate,
                "insufficient": insufficient,
                "excludingFast": {
                    "cutoffSeconds": cutoff,
                    "graduations": slow,
                    "rate": slow_rate,
                    "oneIn": _one_in(slow, slow_rate),
                    "insufficient": insufficient,
                },
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


def _pair_decimals(address: Optional[str], pair_tokens: dict) -> Optional[int]:
    """Decimals for a pool's pair (quote) side. ETH (the zero address) is
    always 18; anything else must carry an explicit "decimals" field in
    pair-tokens.json or the price is unknown -- never guessed. Mirrors
    pipeline/crawl.py's `_pool_pair_decimals` exactly: this module cannot
    import crawl.py (it would pull in pipeline.rpc and the network it
    opens, which stats.py's module docstring forbids), so the same small
    pure rule is kept here instead, and the two must never diverge or an
    hour bar's close and this module's openingPrice would price the same
    pool two different ways."""
    if address is None:
        return None
    if address == ZERO_ADDRESS:
        return 18
    entry = pair_tokens.get(address)
    return entry.get("decimals") if entry else None


def _launched_token_decimals(address: str, pair_tokens: dict) -> int:
    """Decimals for the launched-token side: 18 (pons's standard supply)
    unless pair-tokens.json records something else for this address.
    Mirrors pipeline/crawl.py's `_pool_token_decimals`."""
    entry = pair_tokens.get(address)
    if entry and "decimals" in entry:
        return entry["decimals"]
    return 18


def _opening_price(pool_record: dict, pair_tokens: dict) -> Optional[Decimal]:
    """quote-per-token at this pool's Initialize sqrtPriceX96, or None if
    the pool's orientation is unknown or either side's decimals is
    unknown. currency0/currency1 order is recovered from the two
    addresses (Uniswap v4 requires currency0 < currency1), the same way
    pipeline/crawl.py's `_pool_price` recovers it for a bar -- so an
    unpriceable pool here is unpriceable there too, never inconsistent."""
    token, pair = pool_record["token"], pool_record["pair"]
    if token is None or pair is None:
        return None
    if int(token, 16) < int(pair, 16):
        currency0, currency1 = token, pair
        decimals0 = _launched_token_decimals(token, pair_tokens)
        decimals1 = _pair_decimals(pair, pair_tokens)
    else:
        currency0, currency1 = pair, token
        decimals0 = _pair_decimals(pair, pair_tokens)
        decimals1 = _launched_token_decimals(token, pair_tokens)
    return quote_per_token(pool_record["sqrtPriceX96"], currency0, currency1, token, decimals0, decimals1)


def _bars_by_pool(pool_bars: list) -> dict:
    """Hour bars grouped by pool id, sorted by hour, keeping only bars
    that actually carry a close (a bar with swaps but unknown decimals
    carries `close: null` and cannot answer "what was the price")."""
    by_pool: dict[str, list] = {}
    for bar in pool_bars:
        if bar.get("close") is None:
            continue
        by_pool.setdefault(bar["pool"], []).append((bar["hour"], Decimal(bar["close"])))
    for rows in by_pool.values():
        rows.sort(key=lambda r: r[0])
    return by_pool


def _hour_key(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H")


def _bar_close_at_or_before(bar_rows: list, target_hour: str) -> Optional[Decimal]:
    """The close of the last hour bar at or before target_hour -- never
    the nearest bar. `bar_rows` is sorted ascending by hour string, which
    sorts correctly against target_hour's own "%Y-%m-%dT%H" format."""
    hours = [r[0] for r in bar_rows]
    idx = bisect_right(hours, target_hour) - 1
    return bar_rows[idx][1] if idx >= 0 else None


def _graduation_marks(anchor_ts: int, opening_price: Decimal, bar_rows: list, until_ts: int) -> dict:
    """One entry per OUTCOME_MARKS label whose mark has elapsed as of
    until_ts. A mark absent from the returned dict has not elapsed and is
    not counted toward that mark's n at all. A present value of None is
    `noTrade`: the mark elapsed but no bar exists at or before it -- never
    a price of 0, never dropped. A present Decimal is changeAt."""
    result: dict = {}
    for label, seconds in OUTCOME_MARKS.items():
        mark_ts = anchor_ts + seconds
        if until_ts < mark_ts:
            continue
        close = _bar_close_at_or_before(bar_rows, _hour_key(mark_ts))
        result[label] = None if close is None else (close / opening_price) - 1
    return result


def _quantile(sorted_values: list, p: int) -> Optional[float]:
    """Nearest-rank quantile over a sorted list of Decimal changeAt
    values, the same method ttg_percentiles uses over seconds. Rounded
    once, here, via Decimal.quantize -- never a float division -- before
    it ever becomes a float for JSON."""
    n = len(sorted_values)
    if n == 0:
        return None
    idx = max(0, min(n - 1, math.ceil(p / 100 * n) - 1))
    value = sorted_values[idx]
    return float(value.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP))


def _outcome_mark_row(mark_observations: list) -> dict:
    """mark_observations: one entry per graduation for which this mark has
    elapsed and whose pool has a known opening price -- None for noTrade,
    a Decimal changeAt otherwise. n gates insufficiency for the whole row,
    exactly as every other rate in this module: below MIN_N every
    quantile and the noTrade share are null, never a computed value."""
    n = len(mark_observations)
    no_trade = sum(1 for v in mark_observations if v is None)
    changes = sorted(v for v in mark_observations if v is not None)
    insufficient = n < MIN_N
    return {
        "n": n,
        "noTrade": no_trade,
        "noTradeShare": None if insufficient else round(no_trade / n, 6),
        "median": None if insufficient else _quantile(changes, 50),
        "p25": None if insufficient else _quantile(changes, 25),
        "p75": None if insufficient else _quantile(changes, 75),
        "insufficient": insufficient,
    }


def _outcomes_population(
    launches: list, graduations: list, pool_index: list, pool_bars: list, pair_tokens: dict, until_ts: int
) -> list:
    """One row per graduation that has a matching pons pool (OUTCOMES.md
    "What is computed"), each carrying the launch it belongs to (None for
    an orphan graduation, which no cohort below can place), whether its
    pool's price is known at all, and its per-mark observations."""
    pool_by_token = {p["token"]: p for p in pool_index if p.get("token")}
    bars_by_pool = _bars_by_pool(pool_bars)
    launch_by_token = {l["token"]: l for l in launches}

    rows = []
    for g in graduations:
        pool = pool_by_token.get(g["token"])
        if pool is None:
            continue
        opening_price = _opening_price(pool, pair_tokens)
        marks: dict = {}
        if opening_price is not None:
            bar_rows = bars_by_pool.get(pool["pool"], [])
            marks = _graduation_marks(g["ts"], opening_price, bar_rows, until_ts)
        rows.append(
            {
                "launch": launch_by_token.get(g["token"]),
                "ts": g["ts"],
                "withoutPrice": opening_price is None,
                "marks": marks,
            }
        )
    return rows


def _outcome_bucket_key(row: dict, key: str) -> Optional[str]:
    launch = row["launch"]
    if launch is None:
        return None
    if key == "ttg":
        delta = row["ts"] - launch["ts"]
        if delta < 10:
            return "u10"
        if delta < FAST_CUTOFF:
            return "mid"
        return "over"
    if key == "pair":
        return launch["pairClass"]
    if key == "tax":
        return _tax_bucket(launch["creatorTaxBps"])
    raise ValueError(f"unknown outcome cohort key: {key}")


def _outcome_bucket_list(key: str) -> list:
    return {"ttg": OUTCOME_TTG_BUCKETS, "pair": PAIR_BUCKETS, "tax": TAX_BUCKETS}[key]


def outcomes_cohort(rows: list, key: str) -> list[dict]:
    """One row per bucket: the count of matched graduations in it, how
    many of those have no price at all (excluded from every mark's n, per
    OUTCOMES.md), and each mark's own row. A bucket with zero members
    still emits a full row of zeros/nulls, exactly like every other cohort
    in this module, so the byte diff is stable."""
    buckets = _outcome_bucket_list(key)
    members: dict = {b: [] for b in buckets}
    for row in rows:
        bucket = _outcome_bucket_key(row, key)
        if bucket is not None:
            members[bucket].append(row)

    result = []
    for bucket in buckets:
        bucket_rows = members[bucket]
        without_price = sum(1 for r in bucket_rows if r["withoutPrice"])
        priced_rows = [r for r in bucket_rows if not r["withoutPrice"]]
        result.append(
            {
                "bucket": bucket,
                "graduations": len(bucket_rows),
                "withoutPrice": without_price,
                "marks": {
                    label: _outcome_mark_row([r["marks"][label] for r in priced_rows if label in r["marks"]])
                    for label in OUTCOME_MARKS
                },
            }
        )
    return result


def outcomes_excluded(rows: list, key: str) -> int:
    """Matched graduations with no launch on record, so no cohort of any
    dimension can place them -- the same treatment cohort_excluded gives a
    launch with no readable bucket key."""
    return sum(1 for r in rows if _outcome_bucket_key(r, key) is None)


def outcomes(
    launches: list,
    graduations: list,
    pool_index: list,
    pool_bars: list,
    pair_tokens: dict,
    until_ts: int,
) -> dict:
    """The published `outcomes` block: OUTCOMES.md step 3. Not windowed by
    h24/all-time like the rest of build_number -- it is its own
    population, every graduation that has a pons pool, matched by token,
    with `until_ts` (the same instant crawledAt keys on) deciding which
    marks have elapsed."""
    rows = _outcomes_population(launches, graduations, pool_index, pool_bars, pair_tokens, until_ts)
    return {
        "matched": len(rows),
        "cohorts": {
            "ttg": outcomes_cohort(rows, "ttg"),
            "pair": outcomes_cohort(rows, "pair"),
            "tax": outcomes_cohort(rows, "tax"),
        },
        "cohortsExcluded": {
            "ttg": outcomes_excluded(rows, "ttg"),
            "pair": outcomes_excluded(rows, "pair"),
            "tax": outcomes_excluded(rows, "tax"),
        },
    }


def format_iso(ts: int) -> str:
    """A unix timestamp as the ISO-8601 Z string every published instant
    uses. Public because `crawledAt` is now a block timestamp and both the
    crawl and the recompute have to spell it the same way."""
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def first_indexed_at(launches: list) -> Optional[str]:
    """The earliest launch timestamp in the record, as an ISO-8601 Z string.

    Published beside `firstIndexedBlock` so a consumer can state coverage in
    hours without converting blocks to time -- a conversion METHOD.md
    forbids. Null when nothing is indexed yet.
    """
    if not launches:
        return None
    return format_iso(min(l["ts"] for l in launches))


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


def build_number(
    launches: list,
    graduations: list,
    state: dict,
    crawled_at: str,
    samples: dict | None = None,
    pool_index: list | None = None,
    pool_bars: list | None = None,
    pair_tokens: dict | None = None,
) -> dict:
    # `crawled_at` is chain time: the block timestamp of the last indexed
    # block, passed in by the caller (METHOD.md "Freshness"). Every window
    # closes on it, so a wall clock here would close windows over blocks that
    # were never scanned. This module reads no clock of its own.
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
        # Dated readings that are not windows: each carries its own n and its
        # own measurement date and is passed through by recompute.py exactly
        # as it was committed. Absent samples publish {} rather than nothing,
        # so a consumer never has to tell "no samples" from "old file".
        "samples": dict(samples or {}),
        "h24": _window_block(launches, graduations, since_24h, until, lower_bound=True),
        "allTime": _window_block(launches, graduations, None, until, lower_bound=False),
        # OUTCOMES.md step 3: not a window like h24/allTime above -- every
        # graduation that has a pons pool, joined by token, with `until`
        # (the same crawledAt instant) deciding which marks have elapsed.
        "outcomes": outcomes(launches, graduations, pool_index or [], pool_bars or [], pair_tokens or {}, until),
    }
