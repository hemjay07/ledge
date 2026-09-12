"""
pipeline/pool.py — Uniswap v4 Initialize/Swap decoding and sqrtPriceX96
pricing for pons graduations, in the style of test_rpc.py: pure decoding
and math, offline, no network access anywhere in this file.

topic0 constants (derived, not fetched -- see pool.py's own comment and the
OUTCOMES-DECODE-BRIEF.md report):
  TOPIC_V4_INITIALIZE = 0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
  TOPIC_V4_SWAP       = 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f

Layout (OUTCOMES.md / OUTCOMES-DECODE-BRIEF.md):
  Initialize: indexed(id) · data(currency0, currency1, fee, tickSpacing,
              hooks, sqrtPriceX96, tick)
  Swap:       indexed(id, sender) · data(amount0, amount1, sqrtPriceX96,
              liquidity, tick, fee)
"""
from decimal import Decimal
from fractions import Fraction

import pytest

from pipeline import pool

TOKEN = "0x1111111111111111111111111111111111111111"
QUOTE = "0x2222222222222222222222222222222222222222"


def _pad32(hexstr: str) -> str:
    return hexstr.rjust(64, "0")


def _addr_topic(addr: str) -> str:
    return "0x" + _pad32(addr[2:].lower())


def _int_word(value: int) -> str:
    """Encode a value into a 32-byte ABI word. Negative values are encoded
    with Solidity's own sign-extension-to-256-bits convention, matching
    what a real node would return -- not just the low bits."""
    if value < 0:
        value &= (1 << 256) - 1
    return _pad32(format(value, "x"))


def _make_initialize_log(
    pool_id="0x" + "ab" * 32,
    currency0=TOKEN,
    currency1=QUOTE,
    fee=0,
    tick_spacing=200,
    hooks=pool.PONS_HOOK,
    sqrt_price_x96=2**96,
    tick=0,
    block=55918500,
    tx_hash="0x" + "11" * 32,
    log_index=0,
):
    # id, currency0 and currency1 are INDEXED; data holds the other five.
    # Layout copied from a real log off the deployed PoolManager on
    # 2026-09-12 (see the chain-shaped fixture below), not from the
    # signature -- reading all seven out of data is the bug this shape
    # exists to catch.
    data = "0x" + "".join(
        [
            _int_word(fee),
            _int_word(tick_spacing),
            _int_word(int(hooks, 16)),
            _int_word(sqrt_price_x96),
            _int_word(tick),
        ]
    )
    return {
        "address": pool.POOL_MANAGER,
        "topics": [
            pool.TOPIC_V4_INITIALIZE,
            pool_id,
            _int_word(int(currency0, 16)),
            _int_word(int(currency1, 16)),
        ],
        "data": data,
        "blockNumber": hex(block),
        "transactionHash": tx_hash,
        "logIndex": hex(log_index),
    }


def _make_swap_log(
    pool_id="0x" + "ab" * 32,
    sender="0x3333333333333333333333333333333333333333",
    amount0=0,
    amount1=0,
    sqrt_price_x96=2**96,
    liquidity=0,
    tick=0,
    fee=0,
    block=55918600,
    tx_hash="0x" + "22" * 32,
    log_index=0,
):
    data = "0x" + "".join(
        [
            _int_word(amount0),
            _int_word(amount1),
            _int_word(sqrt_price_x96),
            _int_word(liquidity),
            _int_word(tick),
            _int_word(fee),
        ]
    )
    return {
        "address": pool.POOL_MANAGER,
        "topics": [pool.TOPIC_V4_SWAP, pool_id, _addr_topic(sender)],
        "data": data,
        "blockNumber": hex(block),
        "transactionHash": tx_hash,
        "logIndex": hex(log_index),
    }


# --- topic0 constants --------------------------------------------------------
def test_topic0_initialize_matches_keccak_of_canonical_signature():
    from pipeline.keccak import keccak256

    sig = b"Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"
    assert pool.TOPIC_V4_INITIALIZE == "0x" + keccak256(sig).hex()


def test_topic0_swap_matches_keccak_of_canonical_signature():
    from pipeline.keccak import keccak256

    sig = b"Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"
    assert pool.TOPIC_V4_SWAP == "0x" + keccak256(sig).hex()


# --- decode_initialize --------------------------------------------------------
def test_decode_initialize_extracts_fields():
    log = _make_initialize_log(
        currency0=TOKEN,
        currency1=QUOTE,
        fee=3000,
        tick_spacing=60,
        hooks=pool.PONS_HOOK,
        sqrt_price_x96=2**96,
        tick=0,
    )
    decoded = pool.decode_initialize(log)
    assert decoded["currency0"] == TOKEN
    assert decoded["currency1"] == QUOTE
    assert decoded["fee"] == 3000
    assert decoded["tickSpacing"] == 60
    assert decoded["hooks"] == pool.PONS_HOOK
    assert decoded["sqrtPriceX96"] == 2**96
    assert decoded["tick"] == 0
    assert decoded["block"] == 55918500
    assert decoded["txHash"] == "0x" + "11" * 32
    assert decoded["logIndex"] == 0


def test_decode_initialize_negative_tick_decodes_signed():
    log = _make_initialize_log(tick=-887220)
    decoded = pool.decode_initialize(log)
    assert decoded["tick"] == -887220


def test_decode_initialize_negative_tick_spacing_decodes_signed():
    log = _make_initialize_log(tick_spacing=-1)
    decoded = pool.decode_initialize(log)
    assert decoded["tickSpacing"] == -1


def test_decode_initialize_malformed_short_data_raises():
    log = _make_initialize_log()
    log["data"] = log["data"][:20]  # truncated well short of 7 words
    with pytest.raises(Exception):
        pool.decode_initialize(log)


# --- decode_swap ---------------------------------------------------------------
def test_decode_swap_extracts_fields():
    sender = "0x3333333333333333333333333333333333333333"
    log = _make_swap_log(
        sender=sender,
        amount0=1_000_000,
        amount1=-999_500,
        sqrt_price_x96=2**96,
        liquidity=123456789,
        tick=42,
        fee=3000,
    )
    decoded = pool.decode_swap(log)
    assert decoded["sender"] == sender
    assert decoded["amount0"] == 1_000_000
    assert decoded["amount1"] == -999_500
    assert decoded["sqrtPriceX96"] == 2**96
    assert decoded["liquidity"] == 123456789
    assert decoded["tick"] == 42
    assert decoded["fee"] == 3000
    assert decoded["block"] == 55918600
    assert decoded["txHash"] == "0x" + "22" * 32
    assert decoded["logIndex"] == 0


def test_decode_swap_negative_int128_amount_decodes_signed():
    log = _make_swap_log(amount0=-1, amount1=-(2**100))
    decoded = pool.decode_swap(log)
    assert decoded["amount0"] == -1
    assert decoded["amount1"] == -(2**100)


def test_decode_swap_negative_tick_decodes_signed():
    log = _make_swap_log(tick=-1)
    decoded = pool.decode_swap(log)
    assert decoded["tick"] == -1


def test_decode_swap_malformed_short_data_raises():
    log = _make_swap_log()
    log["data"] = log["data"][:20]  # truncated well short of 6 words
    with pytest.raises(Exception):
        pool.decode_swap(log)


# --- price_from_sqrt -----------------------------------------------------------
def test_price_from_sqrt_equal_decimals_at_sqrt_2_96_is_one():
    price = pool.price_from_sqrt(2**96, decimals0=18, decimals1=18)
    assert price == Decimal(1)


def test_price_from_sqrt_unknown_decimals_returns_none():
    assert pool.price_from_sqrt(2**96, decimals0=None, decimals1=18) is None
    assert pool.price_from_sqrt(2**96, decimals0=18, decimals1=None) is None
    assert pool.price_from_sqrt(2**96, decimals0=None, decimals1=None) is None


def test_price_from_sqrt_18_6_decimal_pair_scales_correctly():
    # sqrtPriceX96 = 2**97 -> raw ratio (sqrtP/2**96)**2 = 2**2 = 4, exactly.
    # currency0 has 18 decimals, currency1 has 6: scale = 10**(18-6) = 1e12.
    # Computed independently here with Fraction, not by calling the
    # function under test.
    sqrt_price_x96 = 2**97
    expected = Fraction(sqrt_price_x96, 2**96) ** 2 * Fraction(10) ** 12
    price = pool.price_from_sqrt(sqrt_price_x96, decimals0=18, decimals1=6)
    assert price == Decimal(expected.numerator) / Decimal(expected.denominator)
    assert price == Decimal(4) * Decimal(10) ** 12


# --- quote_per_token: both orderings give the same price ----------------------
def test_quote_per_token_both_orderings_agree():
    """Worked example (also used in the delivery report):

    token has 18 decimals, quote has 6 decimals (e.g. USDG-style pair).

    Ordering A: currency0 = token, currency1 = quote, sqrtPriceX96 = 2**97.
      raw_ratio = (2**97 / 2**96)**2 = 2**2 = 4
      scale     = 10**(18-6) = 10**12
      price_1_per_0 = 4 * 10**12 = 4,000,000,000,000
      token is currency0 -> quote_per_token = price_1_per_0 = 4e12

    Ordering B: currency0 = quote, currency1 = token, sqrtPriceX96 = 2**95.
      raw_ratio = (2**95 / 2**96)**2 = (1/2)**2 = 1/4
      scale     = 10**(6-18) = 10**-12
      price_1_per_0 = (1/4) * 10**-12 = 2.5e-13   (this is token-per-quote)
      token is currency1 -> quote_per_token = 1 / price_1_per_0 = 4e12

    Both orderings must land on the same 4,000,000,000,000.
    """
    expected = Decimal(4) * Decimal(10) ** 12

    price_a = pool.quote_per_token(
        sqrt_price_x96=2**97,
        currency0=TOKEN,
        currency1=QUOTE,
        token=TOKEN,
        decimals0=18,
        decimals1=6,
    )
    price_b = pool.quote_per_token(
        sqrt_price_x96=2**95,
        currency0=QUOTE,
        currency1=TOKEN,
        token=TOKEN,
        decimals0=6,
        decimals1=18,
    )

    assert price_a == expected
    assert price_b == expected
    assert price_a == price_b


def test_quote_per_token_case_insensitive_token_match():
    price = pool.quote_per_token(
        sqrt_price_x96=2**96,
        currency0=TOKEN,
        currency1=QUOTE,
        token=TOKEN.upper(),
        decimals0=18,
        decimals1=18,
    )
    assert price == Decimal(1)


def test_quote_per_token_unknown_decimals_returns_none():
    price = pool.quote_per_token(
        sqrt_price_x96=2**96,
        currency0=TOKEN,
        currency1=QUOTE,
        token=TOKEN,
        decimals0=None,
        decimals1=18,
    )
    assert price is None


def test_quote_per_token_rejects_token_not_in_pool():
    other = "0x4444444444444444444444444444444444444444"
    with pytest.raises(ValueError):
        pool.quote_per_token(
            sqrt_price_x96=2**96,
            currency0=TOKEN,
            currency1=QUOTE,
            token=other,
            decimals0=18,
            decimals1=18,
        )


# --- is_pons_pool ----------------------------------------------------------------
def test_is_pons_pool_true_for_pons_hook():
    decoded = pool.decode_initialize(_make_initialize_log(hooks=pool.PONS_HOOK))
    assert pool.is_pons_pool(decoded) is True


def test_is_pons_pool_case_insensitive():
    decoded = pool.decode_initialize(_make_initialize_log(hooks=pool.PONS_HOOK.upper()))
    assert pool.is_pons_pool(decoded) is True


def test_is_pons_pool_false_for_other_hook():
    other_hook = "0x9999999999999999999999999999999999999999"
    decoded = pool.decode_initialize(_make_initialize_log(hooks=other_hook))
    assert pool.is_pons_pool(decoded) is False


# ---- the layouts, as the chain actually emits them -------------------------
# Both logs below were read from the deployed PoolManager
# (0x8366a39c…40951, chain 4663) on 2026-09-12 and pasted verbatim. They are
# the only guard against a decoder that agrees with the signature and
# disagrees with the chain, which is exactly what happened on the first pass.

CHAIN_INITIALIZE = {
    "address": pool.POOL_MANAGER,
    "topics": [
        "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
        "0x7e61e15cdb3d13ed6417422a4f36d6410262baa7cafe11f2c16069bc0cd237cc",
        "0x00000000000000000000000010b409f69989bc34e36a5105874f6d64e3eb0bff",
        "0x0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d168",
    ],
    "data": "0x"
    "00000000000000000000000000000000000000000000000000000000000c39d2"
    "00000000000000000000000000000000000000000000000000000000000000c8"
    "0000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000512dc64b8339485d42"
    "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa928d",
    "blockNumber": "0x3a2b1c0",
    "transactionHash": "0x" + "33" * 32,
    "logIndex": "0x4",
}

CHAIN_SWAP = {
    "address": pool.POOL_MANAGER,
    "topics": [
        "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
        "0x284ad8d82e1211731799368ebc099e94fdc1405b91576d49618b32478351ba21",
        "0x0000000000000000000000008876789976decbfcbbbe364623c63652db8c0904",
    ],
    "data": "0x"
    "000000000000000000000000000000000000000000000000204a6516a47e08b3"
    "fffffffffffffffffffffffffffffffffffffffffffffffffffffffea11b7bdf"
    "000000000000000000000000000000000000000000034bf529ae7677cb17282c"
    "0000000000000000000000000000000000000000000000000b23ff0f70ddc7b6"
    "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfab9"
    "0000000000000000000000000000000000000000000000000000000000000000",
    "blockNumber": "0x3a2b1c1",
    "transactionHash": "0x" + "44" * 32,
    "logIndex": "0x9",
}


def test_topic0_constants_match_the_chain_logs():
    assert CHAIN_INITIALIZE["topics"][0] == pool.TOPIC_V4_INITIALIZE
    assert CHAIN_SWAP["topics"][0] == pool.TOPIC_V4_SWAP


def test_decode_initialize_against_a_real_log():
    d = pool.decode_initialize(CHAIN_INITIALIZE)
    assert d["currency0"] == "0x10b409f69989bc34e36a5105874f6d64e3eb0bff"
    assert d["currency1"] == "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
    assert d["fee"] == 0xC39D2
    assert d["tickSpacing"] == 200
    assert d["hooks"] == "0x0000000000000000000000000000000000000000"
    assert d["sqrtPriceX96"] == 0x512DC64B8339485D42
    assert d["tick"] == -355699  # sign-extended across the full word
    assert pool.is_pons_pool(d) is False


def test_decode_swap_against_a_real_log():
    d = pool.decode_swap(CHAIN_SWAP)
    assert d["sender"] == "0x8876789976decbfcbbbe364623c63652db8c0904"
    assert d["amount0"] == 0x204A6516A47E08B3
    assert d["amount1"] == -5_887_001_633  # a sell, negative by sign extension
    assert d["sqrtPriceX96"] == 0x34BF529AE7677CB17282C
    assert d["liquidity"] == 0xB23FF0F70DDC7B6
    assert d["tick"] == -197959
    assert d["fee"] == 0
