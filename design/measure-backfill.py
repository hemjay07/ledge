"""Measure what a pool backfill would cost, before building one.

Not part of the pipeline. Asks two questions against the real endpoints:

  1. How wide a block range will `eth_getLogs` answer when the query is
     filtered to a handful of pool ids (few results, wide range)?
  2. How many pons pools are there per unit of chain, so the id list can be
     sized?

Both decide whether the backfill is an hour's job or a day's, and whether it
fits inside GitHub Actions at all.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

from pipeline.pool import (
    POOL_MANAGER,
    TOPIC_V4_INITIALIZE,
    TOPIC_V4_SWAP,
    decode_initialize,
    is_pons_pool,
)

ENDPOINTS = [
    "https://rpc.ordofi.network",
    "https://rpc.mainnet.chain.robinhood.com",
]


def call(url: str, method: str, params: list, timeout: int = 180, tries: int = 5):
    """One request, retried on the busy/rate-limited answers both endpoints
    give under load. Returns the whole envelope so the caller can see an
    error rather than a KeyError."""
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url,
                json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                {"content-type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = json.load(response)
            if "result" in body:
                return body
            last = str(body.get("error"))[:120]
        except Exception as exc:  # noqa: BLE001 - measurement script
            last = f"{type(exc).__name__}: {exc}"[:120]
        time.sleep(2 * (attempt + 1))
    return {"error": last}


def head_block(url: str):
    body = call(url, "eth_blockNumber", [])
    return int(body["result"], 16) if "result" in body else None


def pool_ids(url: str, head: int, span: int, step: int = 4000) -> list:
    ids = []
    for frm in range(head - span, head, step):
        body = call(
            url,
            "eth_getLogs",
            [
                {
                    "address": POOL_MANAGER,
                    "topics": [TOPIC_V4_INITIALIZE],
                    "fromBlock": hex(frm),
                    "toBlock": hex(frm + step - 1),
                }
            ],
        )
        for log in body.get("result", []):
            decoded = decode_initialize(log)
            if is_pons_pool(decoded):
                ids.append(decoded["id"])
        time.sleep(1)
    return ids


def main() -> int:
    for url in ENDPOINTS:
        print(f"== {url}")
        head = head_block(url)
        if head is None:
            print("   no head; endpoint not answering")
            continue
        ids = pool_ids(url, head, span=24_000)
        print(f"   pons pools in the last 24,000 blocks (~40 min): {len(ids)}")
        if not ids:
            continue
        for span in (10_000, 50_000, 200_000, 600_000, 2_000_000):
            started = time.time()
            body = call(
                url,
                "eth_getLogs",
                [
                    {
                        "address": POOL_MANAGER,
                        "topics": [TOPIC_V4_SWAP, ids[:20]],
                        "fromBlock": hex(max(0, head - span)),
                        "toBlock": hex(head),
                    }
                ],
            )
            if "result" in body:
                print(
                    f"   {span:>9,} blocks -> {len(body['result']):>6,} logs"
                    f" in {time.time() - started:.1f}s"
                )
            else:
                print(f"   {span:>9,} blocks -> refused: {body['error']}")
            time.sleep(1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
