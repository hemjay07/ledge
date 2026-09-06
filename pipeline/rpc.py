"""Batch JSON-RPC client for the Pons factory. stdlib only (urllib). This is
the only module that opens a network connection anywhere in the pipeline.

RPC envelope (ARCHITECTURE.md section 1): batch size 50, 2.0s pacing between
batches for eth_getBlockByNumber/eth_call. A 429 arrives as a single object
where an array was requested -- treated as one retryable failure, not a
parse error. eth_getLogs keeps crawl0.py's proven single-request pacing,
paced by the caller (pipeline/crawl.py), not here.
"""
from __future__ import annotations

import json
import socket
import time
import urllib.error
import urllib.request
from typing import Callable, Optional

TOPIC_TOKEN_LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"
TOPIC_POOL_GRADUATED = "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259"

FACTORY_ADDRESS = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e"
SYMBOL_SELECTOR = "0x95d89b41"  # symbol()

MAX_BATCH = 50
BATCH_PACING_SECONDS = 2.0
MAX_RETRIES = 9
BACKOFF_BASE_SECONDS = 2.0
BACKOFF_CAP_SECONDS = 120.0
RETRYABLE_HTTP = (408, 429, 500, 502, 503, 504)

Transport = Callable[[list], object]


def _pad32(hexstr: str) -> str:
    return hexstr.rjust(64, "0")


def _topic_to_address(topic: str) -> str:
    return "0x" + topic[-40:]


def _data_word(data: str, index: int) -> str:
    start = 2 + index * 64
    return data[start : start + 64]


def is_retryable(response: object) -> bool:
    """Transport-level failures (HTTP 429/5xx, timeouts) the transport hands
    back as a single object; retried with the same backoff as a 429."""
    return isinstance(response, dict) and response.get("code") in RETRYABLE_HTTP


def is_rate_limited(response: object) -> bool:
    """A 429 comes back as a single JSON object instead of the requested
    array. Any other single-object response is a real error, not a
    rate limit. Narrows is_retryable to the one code that means "slow down".
    """
    return is_retryable(response) and response.get("code") == 429


class MalformedBatchResponse(Exception):
    """The provider answered a batch with something that cannot be matched
    back to the requests (wrong length, missing/duplicate ids). Retried on
    the same backoff path as a 429: it is a transport fault, never data."""


def index_batch_response(response: object, expected: int) -> list:
    """Match a JSON-RPC batch response back to its requests by `id`.

    JSON-RPC 2.0 lets a server return batch responses in any order, and a
    short array would otherwise be zipped positionally against the requests
    -- shifting every later result onto the wrong block. Both are refused.
    """
    if not isinstance(response, list):
        raise MalformedBatchResponse(f"expected an array of {expected} responses, got {type(response).__name__}")
    if len(response) != expected:
        raise MalformedBatchResponse(f"expected {expected} responses, got {len(response)}")
    by_id: dict = {}
    for item in response:
        if not isinstance(item, dict) or "id" not in item:
            raise MalformedBatchResponse("batch response item carries no id")
        if item["id"] in by_id:
            raise MalformedBatchResponse(f"duplicate id {item['id']!r} in batch response")
        by_id[item["id"]] = item
    missing = [i for i in range(expected) if i not in by_id]
    if missing:
        raise MalformedBatchResponse(f"batch response missing ids {missing}")
    return [by_id[i].get("result") for i in range(expected)]


def decode_token_launched(log: dict) -> dict:
    topics = log["topics"]
    data = log["data"]
    return {
        "token": _topic_to_address(topics[1]),
        "curve": _topic_to_address(topics[2]),
        "deployer": _topic_to_address(topics[3]),
        "pairToken": "0x" + _data_word(data, 0)[-40:],
        "launchConfigId": int(_data_word(data, 1), 16),
        "graduationThreshold": int(_data_word(data, 2), 16),
        "block": int(log["blockNumber"], 16),
        "txHash": log["transactionHash"],
        "logIndex": int(log["logIndex"], 16),
    }


def decode_pool_graduated(log: dict) -> dict:
    topics = log["topics"]
    data = log["data"]
    return {
        "token": _topic_to_address(topics[1]),
        "positionId": int(_data_word(data, 0), 16),
        "tokenAmount": int(_data_word(data, 1), 16),
        "pairTokenAmount": int(_data_word(data, 2), 16),
        "block": int(log["blockNumber"], 16),
        "txHash": log["transactionHash"],
        "logIndex": int(log["logIndex"], 16),
    }


def _decode_string_return(hex_data: str) -> Optional[str]:
    raw = bytes.fromhex(hex_data[2:])
    if len(raw) < 64:
        return None
    length = int.from_bytes(raw[32:64], "big")
    return raw[64 : 64 + length].decode("utf-8", errors="replace")


def _urllib_transport(url: str) -> Transport:
    def send(payload: list) -> object:
        body = json.dumps(payload).encode()
        request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "User-Agent": "ledge/1.0 (+https://ledge.tools)"})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code in RETRYABLE_HTTP:
                return {"code": exc.code, "message": str(exc)}
            raise
        except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
            return {"code": 503, "message": f"transport: {exc}"}

    return send


class RpcClient:
    """Batch JSON-RPC client with 429-as-object detection and backoff.
    `transport` is injectable for tests; production uses urllib."""

    def __init__(self, url: str, transport: Optional[Transport] = None):
        self.url = url
        self.transport = transport or _urllib_transport(url)

    def _send_with_retry(self, payload: list, validate: Optional[Callable[[object], list]] = None) -> list:
        """Send one payload, retrying transport faults with exponential
        backoff. `validate` maps a raw response to the value to return and
        may raise MalformedBatchResponse to send the request down that same
        retry path."""
        delay = BACKOFF_BASE_SECONDS
        for attempt in range(MAX_RETRIES):
            response = self.transport(payload)
            if is_retryable(response):
                if attempt == MAX_RETRIES - 1:
                    raise RuntimeError(f"rpc: gave up after repeated failures: {response}")
                time.sleep(delay)
                delay = min(delay * 2, BACKOFF_CAP_SECONDS)
                continue
            if validate is None:
                return response
            try:
                return validate(response)
            except MalformedBatchResponse as exc:
                if attempt == MAX_RETRIES - 1:
                    raise RuntimeError(f"rpc: malformed batch response after retries: {exc}") from exc
                time.sleep(delay)
                delay = min(delay * 2, BACKOFF_CAP_SECONDS)
        raise RuntimeError("rpc: gave up after repeated 429 responses")

    def call_batch(self, requests: list) -> list:
        """Results are matched back to requests by `id`, never positionally.
        A response that is short, over-long, or missing an id is refused and
        retried; it never reaches the caller as a shifted or truncated list.
        """
        results: list = []
        chunks = [requests[i : i + MAX_BATCH] for i in range(0, len(requests), MAX_BATCH)]
        for chunk_index, chunk in enumerate(chunks):
            payload = [
                {"jsonrpc": "2.0", "id": i, "method": r["method"], "params": r["params"]}
                for i, r in enumerate(chunk)
            ]
            expected = len(chunk)
            results.extend(
                self._send_with_retry(payload, validate=lambda r, n=expected: index_batch_response(r, n))
            )
            if chunk_index < len(chunks) - 1:
                time.sleep(BATCH_PACING_SECONDS)
        return results

    def get_head_block(self) -> int:
        payload = [{"jsonrpc": "2.0", "id": 0, "method": "eth_blockNumber", "params": []}]
        response = self._send_with_retry(payload)
        return int(response[0]["result"], 16)

    def get_logs(self, from_block: int, to_block: int, topic0: str) -> list:
        payload = [
            {
                "jsonrpc": "2.0",
                "id": 0,
                "method": "eth_getLogs",
                "params": [
                    {
                        "fromBlock": hex(from_block),
                        "toBlock": hex(to_block),
                        "address": FACTORY_ADDRESS,
                        "topics": [topic0],
                    }
                ],
            }
        ]
        # A per-item error (e.g. "log query timed out") -- or an item with no
        # "result" at all -- must never be read as an empty window: only an
        # explicit result is an answer. Anything else retries, then fails
        # the run.
        delay = BACKOFF_BASE_SECONDS
        for attempt in range(MAX_RETRIES):
            response = self._send_with_retry(payload)
            item = response[0] if isinstance(response, list) and response else None
            if isinstance(item, dict) and "error" not in item and "result" in item:
                return item["result"] or []
            if attempt == MAX_RETRIES - 1:
                raise RuntimeError(f"rpc: eth_getLogs gave no result after retries: {item!r}")
            time.sleep(delay)
            delay *= 2
        raise RuntimeError("rpc: unreachable")

    def symbol_of(self, address: str) -> Optional[str]:
        payload = [
            {
                "jsonrpc": "2.0",
                "id": 0,
                "method": "eth_call",
                "params": [{"to": address, "data": SYMBOL_SELECTOR}, "latest"],
            }
        ]
        response = self._send_with_retry(payload)
        result = response[0].get("result")
        return _decode_string_return(result) if result else None
