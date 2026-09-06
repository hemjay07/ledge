#!/usr/bin/env python3
"""Publish the current reading from data/number.json to the LedgeOracle contract.

Stdlib only: urllib for JSON-RPC, pipeline/keccak.py for hashing, and
pipeline/secp256k1.py for signing. No web3, no Foundry. See secp256k1.py for why
signing is done in Python rather than by shelling out to `cast`.

This script never computes a statistic. It reads six values that
pipeline/stats.py already published, converts two of them from a decimal ratio
to basis points, and sends them. It refuses to send at all when the 24h window
is flagged insufficient.

After the transaction is mined it reads the contract back and diffs all six
fields against the file. A mismatch exits non-zero.

Exit codes:
  0  published; or nothing newer to publish; or the window is too small to publish
     from, which is a refusal, not a fault
  1  a check failed: read-back mismatch, revert, bad configuration, RPC exhausted

Environment:
  LEDGE_ORACLE_ADDRESS  the deployed contract (required)
  LEDGE_ORACLE_KEY      the writer's private key, hex (required unless --dry-run)
  RPC_URL               defaults to the Robinhood Chain public endpoint

Usage:
  python pipeline/publish_oracle.py [--dry-run] [--file data/number.json]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

if __package__ in (None, ""):
    # allows `python pipeline/publish_oracle.py` (no PYTHONPATH) as used by the
    # workflows, while leaving package-context imports (pytest) untouched.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.keccak import keccak256
from pipeline.secp256k1 import address_of, parse_private_key, sign

DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com"
DEFAULT_NUMBER_FILE = "data/number.json"
USER_AGENT = "ledge/1.0 (+https://ledge.tools)"

# The endpoint rejects some clients on User-Agent; every request carries ours.
RETRYABLE_HTTP = (408, 429, 500, 502, 503, 504)
MAX_RETRIES = 6
BACKOFF_BASE_SECONDS = 2.0
BACKOFF_CAP_SECONDS = 60.0

RECEIPT_POLL_SECONDS = 2.0
RECEIPT_TIMEOUT_SECONDS = 180.0

# publish((uint32,uint32,uint32,uint32,uint64,bytes8)) and latest()
PUBLISH_SELECTOR = keccak256(b"publish((uint32,uint32,uint32,uint32,uint64,bytes8))")[:4]
LATEST_SELECTOR = keccak256(b"latest()")[:4]

MIN_N = 30  # mirrors LedgeOracle.MIN_N; asserted against the contract before sending
BPS_MAX = 10000
UINT32_MAX = 2**32 - 1

# Selector of LedgeOracle's errors, so a revert reason is readable in the log.
ERROR_NAMES = {
    keccak256(name.encode())[:4].hex(): name
    for name in ("NotWriter()", "NotOwner()", "NotPendingOwner()", "StaleReading()", "ImpossibleReading()")
}


class PublishError(Exception):
    """Anything that should end the job non-zero."""


class Refusal(Exception):
    """The file says this reading must not be published. Not a fault; exits zero."""


# --------------------------------------------------------------------- JSON-RPC


def rpc_call(url: str, method: str, params: list) -> object:
    """One JSON-RPC request with backoff on transport faults. Raises on an RPC error."""
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    last_fault = ""
    for attempt in range(MAX_RETRIES):
        if attempt:
            time.sleep(min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_CAP_SECONDS))
        try:
            request = urllib.request.Request(
                url, data=payload, headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}
            )
            with urllib.request.urlopen(request, timeout=45) as response:
                body = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code in RETRYABLE_HTTP:
                last_fault = f"HTTP {exc.code}"
                continue
            raise PublishError(f"{method}: HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_fault = str(exc)
            continue
        if isinstance(body, dict) and "error" in body:
            raise PublishError(f"{method}: {body['error']}")
        if not isinstance(body, dict) or "result" not in body:
            last_fault = f"malformed response {body!r}"
            continue
        return body["result"]
    raise PublishError(f"{method}: {MAX_RETRIES} attempts failed, last fault: {last_fault}")


def _to_int(value: object) -> int:
    return int(value, 16) if isinstance(value, str) else int(value)


# -------------------------------------------------------------------------- RLP


def rlp_encode(item) -> bytes:
    if isinstance(item, int):
        item = b"" if item == 0 else item.to_bytes((item.bit_length() + 7) // 8, "big")
    if isinstance(item, bytes):
        if len(item) == 1 and item[0] < 0x80:
            return item
        return _rlp_length(len(item), 0x80) + item
    if isinstance(item, list):
        payload = b"".join(rlp_encode(element) for element in item)
        return _rlp_length(len(payload), 0xC0) + payload
    raise TypeError(f"cannot RLP-encode {type(item).__name__}")


def _rlp_length(length: int, offset: int) -> bytes:
    if length < 56:
        return bytes([offset + length])
    encoded = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([offset + 55 + len(encoded)]) + encoded


# ---------------------------------------------------------------- the reading


class Reading:
    """The six fields the contract stores. Nothing here is computed from raw data."""

    FIELDS = (
        "rate24hBps",
        "excludingFastBps",
        "launches24h",
        "graduations24h",
        "crawledAt",
        "definitionsVersion",
    )

    def __init__(self, rate_bps, excluding_fast_bps, launches, graduations, crawled_at, definitions):
        self.rate24hBps = rate_bps
        self.excludingFastBps = excluding_fast_bps
        self.launches24h = launches
        self.graduations24h = graduations
        self.crawledAt = crawled_at
        self.definitionsVersion = definitions  # 8 bytes, ASCII

    def as_dict(self) -> dict:
        values = {name: getattr(self, name) for name in self.FIELDS}
        values["definitionsVersion"] = self.definitionsVersion.decode("ascii", "replace")
        return values

    def abi_words(self) -> bytes:
        return (
            self.rate24hBps.to_bytes(32, "big")
            + self.excludingFastBps.to_bytes(32, "big")
            + self.launches24h.to_bytes(32, "big")
            + self.graduations24h.to_bytes(32, "big")
            + self.crawledAt.to_bytes(32, "big")
            + self.definitionsVersion.ljust(32, b"\x00")
        )

    @classmethod
    def from_abi(cls, data: bytes) -> "Reading":
        if len(data) < 192:
            raise PublishError(f"latest() returned {len(data)} bytes, expected 192")
        word = lambda i: data[i * 32 : (i + 1) * 32]  # noqa: E731
        return cls(
            int.from_bytes(word(0), "big"),
            int.from_bytes(word(1), "big"),
            int.from_bytes(word(2), "big"),
            int.from_bytes(word(3), "big"),
            int.from_bytes(word(4), "big"),
            word(5)[:8],
        )


def bps(rate: float) -> int:
    """A published rate in basis points. A change of unit, not a new statistic:
    the counts ship in the same slot so any reader can recompute the ratio."""
    value = int(round(rate * BPS_MAX))
    if not 0 <= value <= BPS_MAX:
        raise PublishError(f"rate {rate} is outside 0..1")
    return value


def reading_from_number(number: dict) -> Reading:
    """Derive the six contract fields from data/number.json. Refuses an insufficient window."""
    h24 = number["h24"]
    if h24.get("insufficient") or h24.get("rate") is None:
        raise Refusal(f"the 24h window is flagged insufficient (launches={h24.get('launches')})")
    excluding_fast = h24["excludingFast"]
    if excluding_fast.get("insufficient") or excluding_fast.get("rate") is None:
        raise Refusal("h24.excludingFast is flagged insufficient")
    launches = int(h24["launches"])
    graduations = int(h24["graduations"])
    if launches < MIN_N:
        raise Refusal(f"launches {launches} is below MIN_N {MIN_N}")
    if graduations > launches:
        raise PublishError(f"graduations {graduations} exceed launches {launches}")
    if launches > UINT32_MAX or graduations > UINT32_MAX:
        raise PublishError("counts exceed uint32")
    definitions = number["definitionsVersion"].replace("-", "").encode("ascii")
    if len(definitions) != 8:
        raise PublishError(f"definitionsVersion {number['definitionsVersion']!r} is not 8 ASCII bytes")
    return Reading(
        bps(h24["rate"]),
        bps(excluding_fast["rate"]),
        launches,
        graduations,
        int(h24["until"]),
        definitions,
    )


# ------------------------------------------------------------------ transaction


def build_signed_tx(chain_id, nonce, to, data, gas, max_fee, max_priority, private_key) -> bytes:
    unsigned = [
        chain_id,
        nonce,
        max_priority,
        max_fee,
        gas,
        bytes.fromhex(to[2:]),
        0,
        data,
        [],
    ]
    digest = keccak256(b"\x02" + rlp_encode(unsigned))
    r, s, parity = sign(private_key, digest)
    return b"\x02" + rlp_encode(unsigned + [parity, r, s])


def wait_for_receipt(url: str, tx_hash: str) -> dict:
    deadline = time.monotonic() + RECEIPT_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        receipt = rpc_call(url, "eth_getTransactionReceipt", [tx_hash])
        if receipt:
            return receipt
        time.sleep(RECEIPT_POLL_SECONDS)
    raise PublishError(f"no receipt for {tx_hash} after {RECEIPT_TIMEOUT_SECONDS:.0f}s")


def decode_revert(message: str) -> str:
    """Name the contract error behind a revert, so the log says NotWriter() rather
    than a bare selector."""
    for selector in re.findall(r"0x([0-9a-fA-F]{8})\b", message):
        name = ERROR_NAMES.get(selector.lower())
        if name:
            return name
    return message


# ------------------------------------------------------------------------- main


def read_latest(url: str, address: str) -> Reading:
    result = rpc_call(url, "eth_call", [{"to": address, "data": "0x" + LATEST_SELECTOR.hex()}, "latest"])
    return Reading.from_abi(bytes.fromhex(result[2:]))


def diff(sent: Reading, stored: Reading) -> list:
    return [
        f"{name}: sent {sent.as_dict()[name]!r}, chain has {stored.as_dict()[name]!r}"
        for name in Reading.FIELDS
        if getattr(sent, name) != getattr(stored, name)
    ]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=DEFAULT_NUMBER_FILE)
    parser.add_argument("--rpc-url", default=os.environ.get("RPC_URL") or DEFAULT_RPC_URL)
    parser.add_argument("--address", default=os.environ.get("LEDGE_ORACLE_ADDRESS", ""))
    parser.add_argument("--dry-run", action="store_true", help="derive and print the reading, send nothing")
    args = parser.parse_args(argv)

    try:
        with open(args.file, encoding="utf-8") as handle:
            number = json.load(handle)
        reading = reading_from_number(number)
        print(f"reading from {args.file}: {reading.as_dict()}")

        if args.dry_run:
            print("dry run: nothing sent")
            return 0

        address = args.address.strip().lower()
        if not address.startswith("0x") or len(address) != 42:
            raise PublishError("LEDGE_ORACLE_ADDRESS is missing or not an address")
        raw_key = os.environ.get("LEDGE_ORACLE_KEY", "")
        if not raw_key:
            raise PublishError("LEDGE_ORACLE_KEY is not set")
        private_key = parse_private_key(raw_key)
        writer = address_of(private_key)

        chain_id = _to_int(rpc_call(args.rpc_url, "eth_chainId", []))
        if "chainId" in number and chain_id != number["chainId"]:
            raise PublishError(f"RPC is chain {chain_id}, the reading is from chain {number['chainId']}")

        stored = read_latest(args.rpc_url, address)
        if reading.crawledAt <= stored.crawledAt:
            same = "already published" if not diff(reading, stored) else "not newer than the stored reading"
            print(f"{same} (file crawledAt {reading.crawledAt}, chain {stored.crawledAt}); nothing to do")
            return 0

        data = PUBLISH_SELECTOR + reading.abi_words()
        call = {"from": writer, "to": address, "data": "0x" + data.hex()}
        try:
            gas = _to_int(rpc_call(args.rpc_url, "eth_estimateGas", [call, "latest"]))
        except PublishError as exc:
            raise PublishError(f"estimateGas reverted: {decode_revert(str(exc))}") from exc
        gas_limit = gas + gas // 4  # 25% headroom

        block = rpc_call(args.rpc_url, "eth_getBlockByNumber", ["latest", False])
        base_fee = _to_int(block.get("baseFeePerGas") or "0x0")
        try:
            priority = _to_int(rpc_call(args.rpc_url, "eth_maxPriorityFeePerGas", []))
        except PublishError:
            priority = 0
        max_fee = base_fee * 2 + priority
        if max_fee == 0:
            max_fee = _to_int(rpc_call(args.rpc_url, "eth_gasPrice", []))

        balance = _to_int(rpc_call(args.rpc_url, "eth_getBalance", [writer, "latest"]))
        cost_wei = gas_limit * max_fee
        print(
            f"writer {writer} balance {balance / 1e18:.6f} ETH; "
            f"gas {gas} (limit {gas_limit}) at maxFee {max_fee} wei = up to {cost_wei / 1e18:.8f} ETH"
        )
        if cost_wei and balance < cost_wei * 24:
            print(f"warning: writer holds fewer than 24 writes of gas ({balance / 1e18:.6f} ETH)")
        if balance < cost_wei:
            raise PublishError("writer cannot pay for this transaction")

        nonce = _to_int(rpc_call(args.rpc_url, "eth_getTransactionCount", [writer, "pending"]))
        signed = build_signed_tx(chain_id, nonce, address, data, gas_limit, max_fee, priority, private_key)
        tx_hash = rpc_call(args.rpc_url, "eth_sendRawTransaction", ["0x" + signed.hex()])
        print(f"sent {tx_hash}")

        receipt = wait_for_receipt(args.rpc_url, tx_hash)
        if _to_int(receipt.get("status", "0x0")) != 1:
            raise PublishError(f"transaction {tx_hash} reverted")
        gas_used = _to_int(receipt["gasUsed"])
        effective = _to_int(receipt.get("effectiveGasPrice") or max_fee)
        print(f"mined in block {_to_int(receipt['blockNumber'])}: {gas_used} gas, paid {gas_used * effective / 1e18:.8f} ETH")

        differences = diff(reading, read_latest(args.rpc_url, address))
        if differences:
            print("read-back mismatch:")
            for line in differences:
                print(f"  {line}")
            return 1
        print(f"read-back matches {args.file}")
        return 0
    except Refusal as exc:
        print(f"publish_oracle: refusing to publish: {exc}")
        return 0
    except PublishError as exc:
        print(f"publish_oracle: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
