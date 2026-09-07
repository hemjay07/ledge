"""D1 against the repo: the nightly divergence check. No network access.

ARCHITECTURE-PHASE2-4.md §9, gate 7. The hourly Python and the minute Worker
share nothing but the chain (§2). Both resume from their own cursor, both take
timestamps from block headers, and both dedupe on `(txHash, logIndex)`. If the
Worker's indexer is silently wrong — a dropped log window, a bad cursor, a
mis-decoded topic — nothing else in the build notices, because the Worker
never computes a statistic anyone checks. This does.

Two questions are asked, not one:

  * do the COUNTS agree, within 0.5%?
  * are they the SAME EVENTS? A Worker that dropped forty launches and
    double-counted forty others has a count divergence of zero and is
    broken. The key sets catch that; a count never could.

The window ends at the repo's own `crawledAt`, never at "now". The hourly
crawl lags the minute indexer by up to an hour and the architecture disclosed
that lag; reporting it as a fault every night would train everyone to ignore
this job, which is the only failure mode that would actually matter.

Input is whatever `wrangler d1 execute --json` prints, read from a file. The
Worker exposes no bulk export route — `/api/live` is capped at ~200 rows and
strips the token address by design (CONSTRAINTS §2) — and adding one purely
for this job would put a new public surface on the live layer to serve an
internal check. The dump is taken in the workflow instead.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.recompute import load_partitions

WINDOW_SECONDS = 86400
MAX_DIVERGENCE = 0.005  # 0.5%, ARCHITECTURE-PHASE2-4 §2 and §9


def load_rows(payload) -> list[dict]:
    """Normalise what wrangler hands back into a list of row dicts.

    `wrangler d1 execute --json` prints `[{"results": [...], "success": …}]`.
    A bare list of rows and a single `{"results": …}` object are accepted too,
    so a dump taken by hand reconciles the same way as one taken by the job.
    """
    if isinstance(payload, dict):
        for key in ("results", "rows"):
            if key in payload:
                return list(payload[key])
        raise ValueError("no rows in the D1 payload: expected a 'results' or 'rows' key")
    if isinstance(payload, list):
        if not payload:
            return []
        if all(isinstance(item, dict) and "results" in item for item in payload):
            rows: list[dict] = []
            for item in payload:
                rows.extend(item["results"] or [])
            return rows
        if all(isinstance(item, dict) for item in payload):
            return list(payload)
    raise ValueError(f"unreadable D1 payload of type {type(payload).__name__}")


def read_export(path) -> list[dict]:
    return load_rows(json.loads(Path(path).read_text()))


def dedupe_key(row: dict) -> tuple[str, int]:
    """The key both indexers agreed to dedupe on, in either spelling.

    Raises rather than defaulting: a row with no key would otherwise compare
    equal to every other keyless row and quietly hide a real divergence.
    """
    tx = row.get("txHash", row.get("tx_hash"))
    index = row.get("logIndex", row.get("log_index"))
    if tx is None or index is None:
        raise KeyError(f"row carries no (txHash, logIndex): {sorted(row)}")
    return str(tx).lower(), int(index)


def select(rows: list[dict], since: int, until: int) -> list[dict]:
    """The same half-open [since, until) convention as every other window in
    this codebase (METHOD.md, "Window convention")."""
    return [r for r in rows if since <= int(r["ts"]) < until]


def divergence(repo_count: int, d1_count: int) -> float:
    """|d1 - repo| / repo. An empty repo window with an empty D1 window
    agrees; an empty repo window with rows in D1 diverges completely."""
    if repo_count == 0:
        return 0.0 if d1_count == 0 else 1.0
    return abs(d1_count - repo_count) / repo_count


def _compare(repo: list[dict], d1: list[dict], since: int, until: int) -> dict:
    repo_rows = select(repo, since, until)
    d1_rows = select(d1, since, until)
    repo_keys = {dedupe_key(r) for r in repo_rows}
    d1_keys = {dedupe_key(r) for r in d1_rows}

    only_repo = repo_keys - d1_keys
    only_d1 = d1_keys - repo_keys
    disagreements = len(only_repo | only_d1)
    denominator = len(repo_keys) or len(d1_keys)

    return {
        "repo": len(repo_rows),
        "d1": len(d1_rows),
        "divergence": divergence(len(repo_rows), len(d1_rows)),
        "onlyInRepo": len(only_repo),
        "onlyInD1": len(only_d1),
        "keyDivergence": (disagreements / denominator) if denominator else 0.0,
    }


def reconcile(
    repo_launches: list[dict],
    repo_graduations: list[dict],
    d1_launches: list[dict],
    d1_graduations: list[dict],
    since: int,
    until: int,
    max_divergence: float = MAX_DIVERGENCE,
) -> dict:
    launches = _compare(repo_launches, d1_launches, since, until)
    graduations = _compare(repo_graduations, d1_graduations, since, until)

    worst = max(
        launches["divergence"],
        launches["keyDivergence"],
        graduations["divergence"],
        graduations["keyDivergence"],
    )
    return {
        "since": since,
        "until": until,
        "launches": launches,
        "graduations": graduations,
        "maxDivergence": worst,
        "threshold": max_divergence,
        "ok": worst <= max_divergence,
    }


def format_summary(result: dict) -> str:
    """The job log, and the body of the issue the workflow opens."""
    verdict = "OK" if result["ok"] else "FAIL"
    threshold_pct = result["threshold"] * 100
    lines = [
        f"D1 vs repo — {verdict}",
        "",
        f"window  [{result['since']}, {result['until']}) on event timestamps",
        f"threshold  {threshold_pct:.1f}% divergence",
        "",
        f"{'table':<14}{'repo':>10}{'D1':>10}{'count':>10}{'keys':>10}{'only repo':>12}{'only D1':>10}",
    ]
    for name in ("launches", "graduations"):
        row = result[name]
        lines.append(
            f"{name:<14}{row['repo']:>10}{row['d1']:>10}"
            f"{row['divergence'] * 100:>9.2f}%{row['keyDivergence'] * 100:>9.2f}%"
            f"{row['onlyInRepo']:>12}{row['onlyInD1']:>10}"
        )
    lines.append("")
    if result["ok"]:
        lines.append(
            "The two indexers recorded the same events. Counts may still differ by up to "
            "one hour of launches: the hourly crawl lags the minute indexer by design, and "
            "the window already ends at the repo's own crawledAt."
        )
    else:
        lines.append(
            f"Worst divergence {result['maxDivergence'] * 100:.2f}%, above the "
            f"{threshold_pct:.1f}% threshold. Either the Worker's indexer missed events, or "
            "the repo did. 'only D1' counts events the Worker has and the repo does not; "
            "'only repo' is the reverse. Neither side is authoritative for the Number — "
            "data/ is (ARCHITECTURE-PHASE2-4 §2) — so a divergence is investigated, never "
            "resolved by copying one into the other."
        )
    return "\n".join(lines)


def load_repo(data_dir) -> tuple[list[dict], list[dict], str]:
    """The committed partitions and the moment the repo last crawled."""
    data_dir = Path(data_dir)
    state = json.loads((data_dir / "state.json").read_text())
    launches = load_partitions(data_dir / "launches")
    graduations = load_partitions(data_dir / "graduations")
    return launches, graduations, state.get("lastSuccessAt")


def _parse_iso(value: str) -> int:
    from datetime import datetime, timezone

    return int(
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    )


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reconcile the Worker's D1 index against data/.")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--d1-launches", required=True, help="wrangler d1 execute --json output")
    parser.add_argument("--d1-graduations", required=True)
    parser.add_argument("--until", help="ISO-8601 Z; defaults to the repo's lastSuccessAt")
    parser.add_argument("--window-seconds", type=int, default=WINDOW_SECONDS)
    parser.add_argument("--max-divergence", type=float, default=MAX_DIVERGENCE)
    parser.add_argument("--summary-out", help="also write the summary here")
    args = parser.parse_args(argv)

    repo_launches, repo_graduations, last_success = load_repo(args.data_dir)
    until_iso = args.until or last_success
    if not until_iso:
        print("reconcile: the repo has no successful crawl to reconcile against", file=sys.stderr)
        return 1

    until = _parse_iso(until_iso)
    since = until - args.window_seconds

    result = reconcile(
        repo_launches,
        repo_graduations,
        read_export(args.d1_launches),
        read_export(args.d1_graduations),
        since,
        until,
        args.max_divergence,
    )

    summary = format_summary(result)
    print(summary)
    if args.summary_out:
        Path(args.summary_out).write_text(summary + "\n")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
