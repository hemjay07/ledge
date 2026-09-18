"""One-time backfill of launch and graduation rows into the live index.

Until 2026-09-18 the tick evicted launch and graduation rows seven days
after their own timestamp (worker/src/tick.ts), so every token older than
a week lost its launch time, age, cohort and time to graduation on its own
page, while the canonical record (data/launches, data/graduations) held all
of it. The tick now keeps those rows; this script puts back the ones it
already evicted, and the ones from before the live index began (7 Sep).

Rows are inserted with INSERT OR IGNORE on the (tx_hash, log_index) key,
so running it twice writes nothing twice, and a row the tick wrote is
never overwritten. Pair class and creator tax come from the canonical
record, which enriched them from the factory at crawl time.

Runs on the box (it holds D1_API_TOKEN):
    cd /home/ledge/ledge && python3 pipeline/backfill_launches.py --dry-run
    cd /home/ledge/ledge && python3 pipeline/backfill_launches.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.recompute import load_partitions

D1_API_BASE = "https://api.cloudflare.com/client/v4"
ROWS_PER_STATEMENT = 100
# D1 allows 100 bound parameters a query; a hundred launch rows carry a
# thousand. Every value here is a hex string, a small word, or an integer,
# so they are inlined as literals after a strict check, never a free string.
HEX = re.compile(r"^0x[0-9a-f]+$")
WORD = re.compile(r"^[a-z]+$")


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        raise ValueError("no booleans here")
    if isinstance(v, int):
        return str(v)
    if isinstance(v, str) and (HEX.match(v) or WORD.match(v) or v.isdigit()):
        return f"'{v}'"
    raise ValueError(f"refusing to inline {v!r}")

LAUNCH_SQL = (
    "INSERT OR IGNORE INTO launch (token, curve, pair_token, pair_class, creator_tax_bps, "
    "graduation_threshold, block, ts, tx_hash, log_index) VALUES "
)
GRADUATION_SQL = (
    "INSERT OR IGNORE INTO graduation (token, block, ts, pair_token_amount, tx_hash, log_index) VALUES "
)


def launch_params(r: dict) -> list:
    return [
        r["token"].lower(), r["curve"].lower(), r["pairToken"].lower(), r.get("pairClass") or "other",
        r.get("creatorTaxBps"), r.get("graduationThreshold"), int(r["block"]), int(r["ts"]),
        r["txHash"].lower(), int(r["logIndex"]),
    ]


def graduation_params(r: dict) -> list:
    return [r["token"].lower(), int(r["block"]), int(r["ts"]), str(r["pairTokenAmount"]), r["txHash"].lower(), int(r["logIndex"])]


def sender(account_id: str, database_id: str, token: str):
    url = f"{D1_API_BASE}/accounts/{account_id}/d1/database/{database_id}/query"

    def send(sql: str, params: list) -> dict:
        body = json.dumps({"sql": sql, "params": params}).encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    doc = json.load(resp)
                if doc.get("success"):
                    return (doc.get("result") or [{}])[0].get("meta") or {}
                raise RuntimeError(f"d1: {doc.get('errors')}")
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
        return {}

    return send


def insert_all(send, prefix: str, rows: list, width: int, label: str, dry_run: bool) -> int:
    written = 0
    for i in range(0, len(rows), ROWS_PER_STATEMENT):
        chunk = rows[i : i + ROWS_PER_STATEMENT]
        values = ",".join("(" + ",".join(lit(v) for v in row) + ")" for row in chunk)
        if dry_run:
            continue
        meta = send(prefix + values, [])
        written += int(meta.get("changes") or 0)
        if (i // ROWS_PER_STATEMENT) % 50 == 0:
            print(f"{label}: {i + len(chunk):,} of {len(rows):,} sent, {written:,} new", flush=True)
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data = Path(args.data_dir)
    launches = [launch_params(r) for r in load_partitions(data / "launches")]
    graduations = [graduation_params(r) for r in load_partitions(data / "graduations") if not r.get("orphan")]
    print(f"record: {len(launches):,} launches, {len(graduations):,} graduations")
    if args.dry_run:
        print("dry run: nothing sent")
        return 0

    send = sender(os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["D1_DATABASE_ID"], os.environ["D1_API_TOKEN"])
    n_l = insert_all(send, LAUNCH_SQL, launches, 10, "launch", False)
    n_g = insert_all(send, GRADUATION_SQL, graduations, 6, "graduation", False)
    print(f"done: {n_l:,} launch rows and {n_g:,} graduation rows added; the rest were already there")
    return 0


if __name__ == "__main__":
    sys.exit(main())
