"""Uniswap v4 pool decoding and pricing for pons graduations. Pure decoding
and math only -- no network access, in the style of pipeline/rpc.py's own
decoders (plain dicts, ints already parsed, block/txHash/logIndex for
dedupe). This module is read by pipeline/crawl.py, which does the eth_getLogs
calls against the PoolManager; nothing here opens a socket.

OUTCOMES.md step 1: prices for the outcomes tracker come only from
Initialize and Swap logs on the single Uniswap v4 PoolManager pons
graduates into, never from reading pool state at a past block.
"""
from __future__ import annotations

from decimal import Decimal, getcontext

# Enough precision for sqrtPriceX96 (a 160-bit value) squared and scaled by
# up to ~18 decimals of difference -- comfortably more than any float could
# hold, and decimal.Decimal is exact for the divisions/multiplications used
# here (no repeating binary fractions the way float has for /2**96).
getcontext().prec = 60

# Read off the pons factory (poolManager(), memeHook()) 2026-09-12 -- see
# PONS_CONTRACTS.md and OUTCOMES.md "What is on the chain".
POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951"
PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"

# Uniswap v4 PoolManager ABI is not deployed-and-verified reachable from
# here (no network access in this module or its tests), so both topic0s
# are derived with pipeline/keccak.py from the canonical event signature,
# per OUTCOMES-DECODE-BRIEF.md instruction to derive-and-say-so when the
# ABI cannot be fetched:
#
#   python pipeline/keccak.py \
#     "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"
#
# gives 0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438.
TOPIC_V4_INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"

#   python pipeline/keccak.py \
#     "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"
#
# gives 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f.
TOPIC_V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"


def _data_word(data: str, index: int) -> str:
    start = 2 + index * 64
    return data[start : start + 64]


def _topic_to_address(topic: str) -> str:
    return "0x" + topic[-40:]


def _signed_word(word_hex: str, bits: int) -> int:
    """Two's-complement decode of a narrower signed int (int128, int24)
    packed into a full 32-byte ABI word. Solidity sign-extends a negative
    value across the whole word, so the upper bits are just copies of the
    sign bit -- take only the low `bits` bits (rightmost nibbles) before
    checking the sign, or a sign-extended negative reads back as a huge
    positive number instead. A wrong sign here inverts the price or the
    trade direction."""
    raw = int(word_hex[-(bits // 4) :], 16)
    sign_bit = 1 << (bits - 1)
    if raw & sign_bit:
        return raw - (1 << bits)
    return raw


def decode_initialize(log: dict) -> dict:
    """Initialize(bytes32 id, address currency0, address currency1,
    uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96,
    int24 tick) -- one per pool.

    Layout verified against real logs from the deployed PoolManager on
    2026-09-12 (chain 4663, block ~61.0M): `id`, `currency0` and
    `currency1` are INDEXED -- topics[1..3] -- and `data` holds five words,
    fee, tickSpacing, hooks, sqrtPriceX96, tick. An earlier draft read all
    seven out of `data` and raised on the missing words; the fix is why the
    fixtures in the test file are copied from chain logs rather than
    hand-built from the signature."""
    topics = log["topics"]
    data = log["data"]
    return {
        "id": topics[1],
        "currency0": _topic_to_address(topics[2]),
        "currency1": _topic_to_address(topics[3]),
        "fee": int(_data_word(data, 0), 16),
        "tickSpacing": _signed_word(_data_word(data, 1), 24),
        "hooks": "0x" + _data_word(data, 2)[-40:],
        "sqrtPriceX96": int(_data_word(data, 3), 16),
        "tick": _signed_word(_data_word(data, 4), 24),
        "block": int(log["blockNumber"], 16),
        "txHash": log["transactionHash"],
        "logIndex": int(log["logIndex"], 16),
    }


def decode_swap(log: dict) -> dict:
    """Swap(bytes32 id, address sender, int128 amount0, int128 amount1,
    uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee) -- per
    trade. `id` and `sender` are indexed (topics[1] and topics[2]);
    amount0/amount1/sqrtPriceX96/liquidity/tick/fee are the six words of
    `data`, in that order. Layout verified against real logs from the
    deployed PoolManager on 2026-09-12."""
    topics = log["topics"]
    data = log["data"]
    return {
        "id": topics[1],
        "sender": _topic_to_address(topics[2]),
        "amount0": _signed_word(_data_word(data, 0), 128),
        "amount1": _signed_word(_data_word(data, 1), 128),
        "sqrtPriceX96": int(_data_word(data, 2), 16),
        "liquidity": int(_data_word(data, 3), 16),
        "tick": _signed_word(_data_word(data, 4), 24),
        "fee": int(_data_word(data, 5), 16),
        "block": int(log["blockNumber"], 16),
        "txHash": log["transactionHash"],
        "logIndex": int(log["logIndex"], 16),
    }


def price_from_sqrt(
    sqrt_price_x96: int, decimals0: int | None, decimals1: int | None
) -> Decimal | None:
    """currency1 per currency0, from the pool's own sqrtPriceX96 --
    price = (sqrtPriceX96 / 2**96) ** 2, then scaled by the decimals
    difference (10 ** (decimals0 - decimals1)) so the ratio is in whole
    tokens, not raw base units. Null decimals on either side means the
    price cannot be scaled: return None rather than guess -- the same rule
    pipeline/enrich.py and worker/src/decimals.ts already follow."""
    if decimals0 is None or decimals1 is None:
        return None
    raw_ratio = (Decimal(sqrt_price_x96) / Decimal(2**96)) ** 2
    scale = Decimal(10) ** (decimals0 - decimals1)
    return raw_ratio * scale


def quote_per_token(
    sqrt_price_x96: int,
    currency0: str,
    currency1: str,
    token: str,
    decimals0: int | None,
    decimals1: int | None,
) -> Decimal | None:
    """The price in quote-per-token, regardless of whether `token` (the
    launched token) is the pool's currency0 or currency1. price_from_sqrt
    always returns currency1-per-currency0; this flips that to
    quote-per-token by inverting when the launched token is currency1.
    Getting this flip wrong is the single likeliest bug in the tracker."""
    token = token.lower()
    price_1_per_0 = price_from_sqrt(sqrt_price_x96, decimals0, decimals1)
    if price_1_per_0 is None:
        return None
    if token == currency0.lower():
        # token is currency0, quote is currency1: price is already
        # currency1-per-currency0 = quote-per-token.
        return price_1_per_0
    if token == currency1.lower():
        # token is currency1, quote is currency0: invert.
        if price_1_per_0 == 0:
            return None
        return Decimal(1) / price_1_per_0
    raise ValueError(f"token {token!r} is neither currency0 nor currency1 of this pool")


def is_pons_pool(initialize_decoded: dict) -> bool:
    """hooks address equals PONS_HOOK, case-insensitive -- pons is one of
    many users of this PoolManager; everything else is read and dropped."""
    return initialize_decoded["hooks"].lower() == PONS_HOOK.lower()
