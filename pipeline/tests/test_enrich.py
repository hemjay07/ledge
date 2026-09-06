"""
pipeline/enrich.py — getLaunchedToken batches, symbol() lookups, pair-tokens.json upkeep.

Binding rules (ARCHITECTURE.md §3):
  - Batching: 50 calls per batch, 2.0s pacing.
  - Failure handling: batch-level retries, then per-item retry once, then
    give up. A failed item is written with "creatorTaxBps": null. The
    launch STILL COUNTS in every rate -- only the tax cohort excludes it.
  - Pair class: pairToken == 0x0 -> "eth" without a call. An unseen
    non-zero pairToken triggers one symbol() call and appends
    {symbol, class: "other"} to pair-tokens.json for later human
    reclassification.
"""
import pytest

from pipeline import enrich


def _launch(token, pair_token="0x0000000000000000000000000000000000000000"):
    return {
        "token": token, "curve": "0xc", "deployer": "0xd",
        "pairToken": pair_token, "pairClass": None, "creatorTaxBps": None,
        "block": 1000, "ts": 1_700_000_000, "txHash": "0x" + token[2:].rjust(64, "0"), "logIndex": 0,
    }


def test_enrichment_batches_never_exceed_50_calls(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)
    seen_batch_sizes = []

    class _Rpc:
        def call_batch(self, requests):
            seen_batch_sizes.append(len(requests))
            return [{"creatorTaxBps": 0} for _ in requests]

    launches = [_launch(f"0x{i:040x}") for i in range(120)]
    enrich.enrich_launches(launches, _Rpc(), pair_tokens={})
    assert all(size <= 50 for size in seen_batch_sizes)


def test_successful_enrichment_sets_creator_tax_bps(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)

    class _Rpc:
        def call_batch(self, requests):
            return [{"creatorTaxBps": 300} for _ in requests]

    launches = [_launch("0x" + "1" * 40)]
    enriched, failures = enrich.enrich_launches(launches, _Rpc(), pair_tokens={})
    assert enriched[0]["creatorTaxBps"] == 300
    assert failures == 0


def test_enrichment_failure_for_one_token_sets_tax_bps_null_but_keeps_launch(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)

    class _FlakyRpc:
        def __init__(self):
            self.calls = 0

        def call_batch(self, requests):
            self.calls += 1
            # Simulate: batch fails all 3 retry attempts, so enrich.py falls
            # back to per-item retry (also failing) and gives up.
            raise RuntimeError("rpc unavailable")

    launches = [_launch("0x" + "2" * 40), _launch("0x" + "3" * 40)]
    enriched, failures = enrich.enrich_launches(launches, _FlakyRpc(), pair_tokens={})

    # Both launches are still present -- enrichment failure never drops a
    # launch from the dataset, it only nulls the tax field.
    assert len(enriched) == 2
    assert all(l["creatorTaxBps"] is None for l in enriched)
    assert failures == 2


def test_zero_address_pair_token_classified_eth_without_a_call(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)

    call_log = []

    class _Rpc:
        def call_batch(self, requests):
            call_log.extend(requests)
            return [{"creatorTaxBps": 0} for _ in requests]

    launches = [_launch("0x" + "4" * 40, pair_token="0x0000000000000000000000000000000000000000")]
    enriched, _ = enrich.enrich_launches(launches, _Rpc(), pair_tokens={})
    assert enriched[0]["pairClass"] == "eth"


def test_unseen_pair_token_triggers_symbol_lookup_and_appends_other(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)
    pair_token = "0x" + "9" * 40

    class _Rpc:
        def call_batch(self, requests):
            return [{"creatorTaxBps": 0} for _ in requests]

        def symbol_of(self, address):
            return "NEWTOK"

    pair_tokens = {}
    launches = [_launch("0x" + "5" * 40, pair_token=pair_token)]
    enrich.enrich_launches(launches, _Rpc(), pair_tokens=pair_tokens)

    assert pair_token in pair_tokens
    assert pair_tokens[pair_token]["symbol"] == "NEWTOK"
    assert pair_tokens[pair_token]["class"] == "other"


def test_already_known_pair_token_does_not_trigger_another_symbol_call(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)
    pair_token = "0x" + "8" * 40
    symbol_calls = {"n": 0}

    class _Rpc:
        def call_batch(self, requests):
            return [{"creatorTaxBps": 0} for _ in requests]

        def symbol_of(self, address):
            symbol_calls["n"] += 1
            return "SHOULD_NOT_BE_CALLED"

    pair_tokens = {pair_token: {"symbol": "USDX", "class": "stable"}}
    launches = [_launch("0x" + "6" * 40, pair_token=pair_token)]
    enrich.enrich_launches(launches, _Rpc(), pair_tokens=pair_tokens)

    assert symbol_calls["n"] == 0
    assert pair_tokens[pair_token]["class"] == "stable"


# --- W8: a truncated getLaunchedToken return is a failure, not tax 0% -------
def test_truncated_return_data_decodes_to_null_not_zero_tax():
    """getLaunchedToken returns a 15-word static tuple. "0x" (the return of
    a reverted/absent call) must not decode to creatorTaxBps 0, which would
    silently inflate the 0% tax cohort."""
    assert enrich._decode_get_launched_token("0x")["creatorTaxBps"] is None


def test_short_return_data_below_15_words_decodes_to_null():
    short = "0x" + "00" * 32 * 9  # 9 words: word[8] readable, tuple still truncated
    assert enrich._decode_get_launched_token(short)["creatorTaxBps"] is None


def test_full_15_word_return_data_decodes_creator_tax_bps():
    words = [0] * 15
    words[8] = 300
    full = "0x" + "".join(format(w, "064x") for w in words)
    assert enrich._decode_get_launched_token(full)["creatorTaxBps"] == 300


def test_truncated_return_counts_as_an_enrichment_failure(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)

    class _TruncatingRpc:
        def call_batch(self, requests):
            return ["0x" for _ in requests]

    launches = [_launch("0x" + "7" * 40)]
    enriched, failures = enrich.enrich_launches(launches, _TruncatingRpc(), pair_tokens={})

    assert len(enriched) == 1  # the launch still counts in every rate
    assert enriched[0]["creatorTaxBps"] is None
    assert failures == 1


def test_full_return_data_over_the_wire_is_not_a_failure(monkeypatch):
    monkeypatch.setattr(enrich.time, "sleep", lambda *_: None)
    words = [0] * 15
    words[8] = 0  # a genuine 0% tax is data, not a failure
    full = "0x" + "".join(format(w, "064x") for w in words)

    class _Rpc:
        def call_batch(self, requests):
            return [full for _ in requests]

    enriched, failures = enrich.enrich_launches([_launch("0x" + "a" * 40)], _Rpc(), pair_tokens={})
    assert enriched[0]["creatorTaxBps"] == 0
    assert failures == 0
