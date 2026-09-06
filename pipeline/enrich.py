"""getLaunchedToken enrichment: creatorTaxBps, and pair-tokens.json upkeep
for unseen pair tokens. Binding rules: ARCHITECTURE.md section 3.

Batching: 50 calls per batch, three batch-level retries with backoff (2s,
4s, 8s), then one per-item retry, then give up -- a failed item keeps its
launch and gets "creatorTaxBps": null. The injected `rpc` only needs
`call_batch(requests)` and, for unseen pair tokens, `symbol_of(address)`.
"""
from __future__ import annotations

import time
from typing import Optional

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
FACTORY_ADDRESS = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"
GET_LAUNCHED_TOKEN_SELECTOR = "0x3cf28b5a"

BATCH_SIZE = 50
BATCH_RETRY_DELAYS = (2, 4, 8)


def _chunks(items: list, size: int) -> list:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _get_launched_token_request(token: str) -> dict:
    data = GET_LAUNCHED_TOKEN_SELECTOR + token[2:].rjust(64, "0")
    return {"method": "eth_call", "params": [{"to": FACTORY_ADDRESS, "data": data}, "latest"]}


def _decode_get_launched_token(result: object) -> dict:
    """Accepts either a pre-decoded dict (test doubles) or a raw eth_call
    hex string (production), returning {"creatorTaxBps": int|None}."""
    if isinstance(result, dict):
        return result
    raw = bytes.fromhex(result[2:])
    word = lambda i: int.from_bytes(raw[i * 32 : i * 32 + 32], "big")
    return {"creatorTaxBps": word(8)}


def _call_batch_with_item_fallback(rpc, batch: list) -> list:
    requests = [_get_launched_token_request(l["token"]) for l in batch]

    for attempt, delay in enumerate(BATCH_RETRY_DELAYS):
        try:
            return rpc.call_batch(requests)
        except Exception:
            if attempt < len(BATCH_RETRY_DELAYS) - 1:
                time.sleep(delay)

    results = []
    for request in requests:
        try:
            results.append(rpc.call_batch([request])[0])
        except Exception:
            results.append(None)
    return results


def _assign_pair_class(launch: dict, rpc, pair_tokens: dict) -> None:
    pair_token = launch["pairToken"]
    if pair_token == ZERO_ADDRESS:
        launch["pairClass"] = "eth"
        return
    entry = pair_tokens.get(pair_token)
    if entry is not None:
        launch["pairClass"] = entry.get("class", "other")
        return
    symbol = rpc.symbol_of(pair_token)
    pair_tokens[pair_token] = {"symbol": symbol, "class": "other"}
    launch["pairClass"] = "other"


def enrich_launches(launches: list, rpc, pair_tokens: dict) -> tuple:
    enriched = []
    failures = 0

    for batch in _chunks(launches, BATCH_SIZE):
        results = _call_batch_with_item_fallback(rpc, batch)
        for launch, result in zip(batch, results):
            launch = dict(launch)
            if result is None:
                launch["creatorTaxBps"] = None
                failures += 1
            else:
                decoded = _decode_get_launched_token(result)
                launch["creatorTaxBps"] = decoded.get("creatorTaxBps")
            _assign_pair_class(launch, rpc, pair_tokens)
            enriched.append(launch)

    return enriched, failures
