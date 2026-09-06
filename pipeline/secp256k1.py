"""Pure-Python secp256k1 signing, stdlib only.

Used by pipeline/publish_oracle.py to sign the hourly oracle transaction. The
alternative was shelling out to `cast wallet sign` from Foundry; pure Python was
chosen so the publish job needs no toolchain install, so the key never crosses a
subprocess boundary, and because the pipeline is stdlib-only everywhere else and
already carries a pure-Python keccak256 (pipeline/keccak.py) for the same reason.

Nonces are RFC 6979 deterministic (HMAC-SHA256), so signing is a pure function of
(key, message) with no dependence on system randomness. Signatures are normalised
to low-s and carry the Ethereum recovery parity, as EIP-155/EIP-1559 require.
"""
from __future__ import annotations

import hashlib
import hmac
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.keccak import keccak256

P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8


def _inv(a: int, m: int) -> int:
    return pow(a, m - 2, m)


def _add(p1, p2):
    """Affine point addition on y^2 = x^3 + 7 over F_p. None is the identity."""
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1) * _inv(2 * y1, P) % P
    else:
        lam = (y2 - y1) * _inv(x2 - x1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return (x3, (lam * (x1 - x3) - y1) % P)


def _mul(k: int, point=(GX, GY)):
    result = None
    addend = point
    while k:
        if k & 1:
            result = _add(result, addend)
        addend = _add(addend, addend)
        k >>= 1
    return result


def _rfc6979_k(private_key: int, digest: bytes) -> int:
    """Deterministic nonce, RFC 6979 section 3.2 with HMAC-SHA256."""
    v = b"\x01" * 32
    k = b"\x00" * 32
    key_bytes = private_key.to_bytes(32, "big")
    k = hmac.new(k, v + b"\x00" + key_bytes + digest, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + key_bytes + digest, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        candidate = int.from_bytes(v, "big")
        if 1 <= candidate < N:
            return candidate
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()


def public_key(private_key: int) -> bytes:
    """Uncompressed public key without the 0x04 prefix: x||y, 64 bytes."""
    x, y = _mul(private_key)
    return x.to_bytes(32, "big") + y.to_bytes(32, "big")


def address_of(private_key: int) -> str:
    """Checksum-free lowercase 0x address for a private key."""
    return "0x" + keccak256(public_key(private_key))[-20:].hex()


def sign(private_key: int, digest: bytes) -> tuple[int, int, int]:
    """Sign a 32-byte digest. Returns (r, s, y_parity) with s normalised low."""
    if not 1 <= private_key < N:
        raise ValueError("private key out of range")
    if len(digest) != 32:
        raise ValueError("digest must be 32 bytes")
    z = int.from_bytes(digest, "big")
    while True:
        k = _rfc6979_k(private_key, digest)
        point = _mul(k)
        if point is None:
            continue
        x, y = point
        r = x % N
        if r == 0:
            continue
        s = _inv(k, N) * (z + r * private_key) % N
        if s == 0:
            continue
        parity = (y & 1) ^ (1 if x >= N else 0)
        if s > N // 2:
            s = N - s
            parity ^= 1
        return r, s, parity


def parse_private_key(raw: str) -> int:
    """Accept a hex key with or without the 0x prefix."""
    text = raw.strip()
    if text.startswith(("0x", "0X")):
        text = text[2:]
    if len(text) != 64:
        raise ValueError("private key must be 32 hex bytes")
    return int(text, 16)
