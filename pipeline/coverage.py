"""The live index's coverage, measured against the canonical record.

INDEXER.md section 3 and TODO A4. Every ten minutes the crawl runner, after
the crawl, samples up to 200 launches the canonical partitions hold for the
last 24 hours and asks the live index (Cloudflare D1, token_activity) which
of them it has a row for, and for how many it read the launch block. The
answer is written to data/coverage.json beside number.json and shown on
/method.

Class B: a count about our own index, not a statistic about pons, so it
lives outside pipeline/stats.py and the recompute gate. It is published
with its n like everything else, and below n = 30 the share is null.

The sample is deterministic -- every k-th launch of the window in block
order -- so two runs over the same record agree and the figure can be
reproduced from the partitions and the database.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.recompute import load_partitions

SAMPLE_SIZE = 200
WINDOW_SECONDS = 86_400
MIN_N = 30
D1_API_BASE = "https://api.cloudflare.com/client/v4"


def sample(launches: list, size: int) -> list:
    ordered = sorted(launches, key=lambda l: l["block"])
    if len(ordered) <= size:
        return ordered
    step = len(ordered) / size
    return [ordered[int(i * step)] for i in range(size)]


def measure(launches: list, query, sampled: int, cursor_last_success_at: int, measured_at: int) -> dict:
    chosen = sample(launches, sampled)
    rows = {}
    tokens = [l["token"] for l in chosen]
    for i in range(0, len(tokens), 50):
        for row in query(tokens[i : i + 50]):
            rows[row["token"]] = row
    present = sum(1 for t in tokens if t in rows)
    launch_block_read = sum(1 for t in tokens if t in rows and rows[t].get("first_block_buyers") is not None)
    n = len(tokens)
    insufficient = n < MIN_N
    return {
        "measuredAt": _iso(measured_at),
        "window": "launches in the last 24 hours of the canonical record",
        "sampled": n,
        "present": present,
        "presentShare": None if insufficient else round(present / n, 4),
        "launchBlockRead": launch_block_read,
        "launchBlockReadShare": None if insufficient else round(launch_block_read / n, 4),
        "insufficient": insufficient,
        "cursorLastSuccessAt": _iso(cursor_last_success_at),
        "cursorAgeSeconds": max(0, measured_at - cursor_last_success_at),
    }


def _iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> int:
    return int(datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def d1_query_factory(account_id: str, database_id: str, token: str):
    """A query function over D1's HTTP API, the same endpoint and body the
    host runner uses (worker/host/d1-http.ts)."""
    url = f"{D1_API_BASE}/accounts/{account_id}/d1/database/{database_id}/query"

    def send(sql: str, params: list) -> list:
        body = json.dumps({"sql": sql, "params": params}).encode()
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            doc = json.load(resp)
        if not doc.get("success"):
            raise RuntimeError(f"d1: {doc.get('errors')}")
        return (doc.get("result") or [{}])[0].get("results") or []

    def query(tokens: list) -> list:
        placeholders = ",".join("?" for _ in tokens)
        return send(f"SELECT token, first_block_buyers FROM token_activity WHERE token IN ({placeholders})", tokens)

    def cursor() -> int:
        rows = send("SELECT last_success_at FROM cursor WHERE id = 1", [])
        return int(rows[0]["last_success_at"]) if rows else 0

    return query, cursor


def run(data_dir, query, cursor, now: int | None = None) -> dict:
    data_dir = Path(data_dir)
    now = int(datetime.now(timezone.utc).timestamp()) if now is None else now
    state = json.loads((data_dir / "state.json").read_text())
    until = _parse_iso(state["lastIndexedAt"]) if state.get("lastIndexedAt") else now
    launches = [l for l in load_partitions(data_dir / "launches") if until - WINDOW_SECONDS <= l["ts"] < until]
    doc = measure(launches, query, SAMPLE_SIZE, cursor(), now)
    (data_dir / "coverage.json").write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    return doc


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Measure the live index's coverage of the canonical record.")
    parser.add_argument("--data-dir", default="data")
    args = parser.parse_args()
    query, cursor = d1_query_factory(
        os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["D1_DATABASE_ID"], os.environ["D1_API_TOKEN"]
    )
    out = run(args.data_dir, query, cursor)
    print(f"coverage: {out['present']} of {out['sampled']} sampled launches present; launch block read for {out['launchBlockRead']}; cursor {out['cursorAgeSeconds']} s old")
