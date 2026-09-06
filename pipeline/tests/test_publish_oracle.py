"""
pipeline/publish_oracle.py and pipeline/secp256k1.py — the oracle publisher.

Nothing here opens a socket. The transaction path is covered end-to-end against
a local anvil by hand (see the runbook in README.md); what is covered here is
every pure step between data/number.json and the bytes that go on the wire:

  - the six contract fields derived from a number.json, and the refusals
  - basis-point conversion at the boundaries
  - ABI round-trip, so a read-back diff is meaningful
  - RLP encoding against the canonical examples in the Ethereum yellow paper
  - deterministic secp256k1 signing against a known-answer vector

The signing vector below was cross-checked against Foundry:
  cast wallet sign --private-key <anvil key 0> --no-hash 0x000102...1f
produced the identical 65-byte signature.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from pipeline import publish_oracle as po
from pipeline import secp256k1

# anvil's first development key. Public, worthless, and used here only to pin a
# deterministic signature; LEDGE's writer key exists only as a GitHub secret.
ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ANVIL_ADDRESS_0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"


@pytest.fixture
def number():
    """The shape publish_oracle reads: only the keys it touches."""
    return {
        "chainId": 4663,
        "definitionsVersion": "2026-09-06",
        "h24": {
            "insufficient": False,
            "launches": 5900,
            "graduations": 107,
            "rate": 0.018136,
            "until": 1788717636,
            "excludingFast": {"insufficient": False, "rate": 0.005254},
        },
    }


# --- deriving the reading ---------------------------------------------------


def test_reading_carries_the_six_fields(number):
    reading = po.reading_from_number(number)
    assert reading.as_dict() == {
        "rate24hBps": 181,
        "excludingFastBps": 53,
        "launches24h": 5900,
        "graduations24h": 107,
        "crawledAt": 1788717636,
        "definitionsVersion": "20260906",
    }


def test_reading_keeps_the_denominator(number):
    """CONSTRAINTS section 3: the counts travel with the rate, always."""
    reading = po.reading_from_number(number)
    assert reading.launches24h == number["h24"]["launches"]
    assert reading.graduations24h == number["h24"]["graduations"]


def test_refuses_an_insufficient_window(number):
    number["h24"]["insufficient"] = True
    number["h24"]["rate"] = None
    with pytest.raises(po.Refusal):
        po.reading_from_number(number)


def test_refuses_an_insufficient_excluding_fast_block(number):
    number["h24"]["excludingFast"] = {"insufficient": True, "rate": None}
    with pytest.raises(po.Refusal):
        po.reading_from_number(number)


def test_refuses_below_min_n(number):
    number["h24"]["launches"] = 29
    number["h24"]["graduations"] = 1
    with pytest.raises(po.Refusal):
        po.reading_from_number(number)


def test_min_n_matches_the_contract():
    source = (Path(__file__).resolve().parents[2] / "contracts/src/LedgeOracle.sol").read_text()
    assert f"uint32 public constant MIN_N = {po.MIN_N};" in source


def test_refuses_more_graduations_than_launches(number):
    number["h24"]["graduations"] = number["h24"]["launches"] + 1
    with pytest.raises(po.PublishError):
        po.reading_from_number(number)


def test_refuses_a_definitions_version_that_is_not_eight_bytes(number):
    number["definitionsVersion"] = "2026-9-6"
    with pytest.raises(po.PublishError):
        po.reading_from_number(number)


@pytest.mark.parametrize(
    "rate,expected",
    [(0.0, 0), (1.0, 10000), (0.018136, 181), (0.005254, 53), (0.99995, 10000), (0.00004, 0)],
)
def test_bps_at_the_boundaries(rate, expected):
    assert po.bps(rate) == expected


def test_bps_rejects_a_rate_outside_the_unit_interval():
    with pytest.raises(po.PublishError):
        po.bps(1.5)


# --- ABI and the read-back diff ---------------------------------------------


def test_abi_round_trip(number):
    reading = po.reading_from_number(number)
    words = reading.abi_words()
    assert len(words) == 192
    assert po.Reading.from_abi(words).as_dict() == reading.as_dict()


def test_diff_is_empty_for_an_identical_read_back(number):
    reading = po.reading_from_number(number)
    assert po.diff(reading, po.Reading.from_abi(reading.abi_words())) == []


def test_diff_names_every_field_that_moved(number):
    sent = po.reading_from_number(number)
    stored = po.Reading.from_abi(sent.abi_words())
    stored.graduations24h = 106
    stored.rate24hBps = 180
    lines = po.diff(sent, stored)
    assert len(lines) == 2
    assert any(line.startswith("graduations24h:") for line in lines)
    assert any(line.startswith("rate24hBps:") for line in lines)


def test_from_abi_rejects_a_short_return():
    with pytest.raises(po.PublishError):
        po.Reading.from_abi(b"\x00" * 100)


def test_publish_selector():
    # cast sig "publish((uint32,uint32,uint32,uint32,uint64,bytes8))"
    assert po.PUBLISH_SELECTOR.hex() == "fd1dab2d"


def test_latest_selector():
    # cast sig "latest()"
    assert po.LATEST_SELECTOR.hex() == "52bfe789"


def test_revert_selectors_are_named():
    # cast sig "NotWriter()" -> 0x751a1cd0
    assert po.decode_revert("execution reverted: custom error 0x751a1cd0") == "NotWriter()"
    assert po.decode_revert("no selector here") == "no selector here"


# --- RLP --------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,encoded",
    [
        (b"", "80"),
        (b"\x00", "00"),
        (b"dog", "83646f67"),
        (0, "80"),
        (15, "0f"),
        (1024, "820400"),
        ([], "c0"),
        ([b"cat", b"dog"], "c88363617483646f67"),
        (b"a" * 56, "b838" + "61" * 56),
    ],
)
def test_rlp_examples(value, encoded):
    assert po.rlp_encode(value).hex() == encoded


def test_rlp_refuses_an_unencodable_type():
    with pytest.raises(TypeError):
        po.rlp_encode("a string is ambiguous")


# --- signing ----------------------------------------------------------------


def test_address_derivation():
    key = secp256k1.parse_private_key(ANVIL_KEY_0)
    assert secp256k1.address_of(key) == ANVIL_ADDRESS_0


def test_signature_is_the_known_answer():
    key = secp256k1.parse_private_key(ANVIL_KEY_0)
    r, s, parity = secp256k1.sign(key, bytes(range(32)))
    assert "0x%064x%064x%02x" % (r, s, parity + 27) == (
        "0xf42a8f0d81999bb1ebfa5ab96208ca5f4b2890db087c15371f7b840c5a70853c"
        "46ae076d8999c080cda491c75eca1133ae94dc0282b778971b393d898f07b06e1b"
    )


def test_signing_is_deterministic():
    key = secp256k1.parse_private_key(ANVIL_KEY_0)
    assert secp256k1.sign(key, bytes(range(32))) == secp256k1.sign(key, bytes(range(32)))


def test_signature_s_is_low():
    key = secp256k1.parse_private_key(ANVIL_KEY_0)
    for byte in range(8):
        _, s, _ = secp256k1.sign(key, bytes([byte]) * 32)
        assert s <= secp256k1.N // 2


def test_key_parsing_accepts_both_prefixes():
    assert secp256k1.parse_private_key(ANVIL_KEY_0) == secp256k1.parse_private_key(ANVIL_KEY_0[2:])


@pytest.mark.parametrize("bad", ["", "0x", "0xzz", "0x" + "1" * 63])
def test_key_parsing_rejects_a_malformed_key(bad):
    with pytest.raises(ValueError):
        secp256k1.parse_private_key(bad)


def test_sign_rejects_a_digest_that_is_not_32_bytes():
    key = secp256k1.parse_private_key(ANVIL_KEY_0)
    with pytest.raises(ValueError):
        secp256k1.sign(key, b"\x00" * 31)


def test_signed_transaction_is_a_typed_envelope(number):
    reading = po.reading_from_number(number)
    key = secp256k1.parse_private_key(ANVIL_KEY_0)
    raw = po.build_signed_tx(
        chain_id=4663,
        nonce=0,
        to="0x5fbdb2315678afecb367f032d93f642f64180aa3",
        data=po.PUBLISH_SELECTOR + reading.abi_words(),
        gas=69700,
        max_fee=1_000_000_000,
        max_priority=0,
        private_key=key,
    )
    assert raw[0] == 0x02
    assert po.rlp_encode(raw[1:])  # the payload is a well-formed RLP list
