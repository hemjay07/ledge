"""
pipeline/rpc.py — batch JSON-RPC client, 429-as-object detection, backoff,
pacing, and pure log decoding for TokenLaunched / PoolGraduated.

Only the pure, transport-mocked parts are covered here; nothing in this
file makes a real network call.

topic0 constants (METHOD.md / PONS_CONTRACTS.md):
  TokenLaunched  = 0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607
  PoolGraduated  = 0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259

Layouts (PONS_CONTRACTS.md "Decoded layouts"):
  TokenLaunched: indexed(token, curve, deployer) · data(pairToken, launchConfigId, graduationThreshold)
  PoolGraduated: indexed(token) · data(positionId, tokenAmount, pairTokenAmount)

RPC envelope (ARCHITECTURE.md §1):
  batch size 50, one batch per 2.0s for eth_getBlockByNumber/eth_call.
  A 429 arrives as a SINGLE OBJECT where an array was requested -- must be
  detected as a retryable rate-limit, not a parse error.
"""
import pytest

from pipeline import rpc

TOKEN_LAUNCHED_TOPIC0 = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607"
POOL_GRADUATED_TOPIC0 = "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259"


def _pad32(hexstr: str) -> str:
    return hexstr.rjust(64, "0")


def _addr_topic(addr: str) -> str:
    return "0x" + _pad32(addr[2:].lower())


def _uint_word(value: int) -> str:
    return _pad32(format(value, "x"))


def _make_token_launched_log(
    token="0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2",
    curve="0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
    deployer="0x03102c27b522664e643441bf86492bf652c2251c",
    pair_token="0x0000000000000000000000000000000000000000",
    launch_config_id=0,
    graduation_threshold=4_200_000_000_000_000_000,  # 4.2 ETH in wei
    block=55918435,
    tx_hash="0x" + "ab" * 32,
    log_index=3,
):
    data = "0x" + _uint_word(int(pair_token, 16)) + _uint_word(launch_config_id) + _uint_word(graduation_threshold)
    return {
        "address": "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
        "topics": [TOKEN_LAUNCHED_TOPIC0, _addr_topic(token), _addr_topic(curve), _addr_topic(deployer)],
        "data": data,
        "blockNumber": hex(block),
        "transactionHash": tx_hash,
        "logIndex": hex(log_index),
    }


def _make_pool_graduated_log(
    token="0xc1fe816024c51b6dc493b2f7edd7e7f05ed1be4a",
    position_id=42,
    token_amount=1_000_000_000_000_000_000_000_000_000,
    pair_token_amount=8_090_000_094,
    block=55919124,
    tx_hash="0x" + "cd" * 32,
    log_index=1,
):
    data = "0x" + _uint_word(position_id) + _uint_word(token_amount) + _uint_word(pair_token_amount)
    return {
        "address": "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
        "topics": [POOL_GRADUATED_TOPIC0, _addr_topic(token)],
        "data": data,
        "blockNumber": hex(block),
        "transactionHash": tx_hash,
        "logIndex": hex(log_index),
    }


# --- topic0 constants --------------------------------------------------------
def test_topic0_constants_match_method_md():
    assert rpc.TOPIC_TOKEN_LAUNCHED.lower() == TOKEN_LAUNCHED_TOPIC0.lower()
    assert rpc.TOPIC_POOL_GRADUATED.lower() == POOL_GRADUATED_TOPIC0.lower()


# --- log decoding ------------------------------------------------------------
def test_decode_token_launched_extracts_indexed_fields():
    log = _make_token_launched_log(
        token="0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2",
        curve="0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
        deployer="0x03102c27b522664e643441bf86492bf652c2251c",
    )
    decoded = rpc.decode_token_launched(log)
    assert decoded["token"] == "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2"
    assert decoded["curve"] == "0xf6e86610771ee7838cabe2f9c376265ca25ef04c"
    assert decoded["deployer"] == "0x03102c27b522664e643441bf86492bf652c2251c"


def test_decode_token_launched_extracts_data_fields():
    log = _make_token_launched_log(
        pair_token="0x0000000000000000000000000000000000000000",
        launch_config_id=7,
        graduation_threshold=4_200_000_000_000_000_000,
    )
    decoded = rpc.decode_token_launched(log)
    assert decoded["pairToken"] == "0x0000000000000000000000000000000000000000"
    assert decoded["launchConfigId"] == 7
    assert decoded["graduationThreshold"] == 4_200_000_000_000_000_000


def test_decode_token_launched_extracts_block_and_dedupe_key():
    log = _make_token_launched_log(block=55918435, tx_hash="0x" + "ab" * 32, log_index=3)
    decoded = rpc.decode_token_launched(log)
    assert decoded["block"] == 55918435
    assert decoded["txHash"] == "0x" + "ab" * 32
    assert decoded["logIndex"] == 3


def test_decode_pool_graduated_extracts_indexed_and_data_fields():
    log = _make_pool_graduated_log(
        token="0xc1fe816024c51b6dc493b2f7edd7e7f05ed1be4a",
        position_id=42,
        token_amount=999,
        pair_token_amount=8_090_000_094,
    )
    decoded = rpc.decode_pool_graduated(log)
    assert decoded["token"] == "0xc1fe816024c51b6dc493b2f7edd7e7f05ed1be4a"
    assert decoded["positionId"] == 42
    assert decoded["tokenAmount"] == 999
    assert decoded["pairTokenAmount"] == 8_090_000_094


def test_decode_pool_graduated_extracts_block_and_dedupe_key():
    log = _make_pool_graduated_log(block=55919124, tx_hash="0x" + "cd" * 32, log_index=1)
    decoded = rpc.decode_pool_graduated(log)
    assert decoded["block"] == 55919124
    assert decoded["txHash"] == "0x" + "cd" * 32
    assert decoded["logIndex"] == 1


# --- 429-as-object detection --------------------------------------------------
def test_429_single_object_response_is_detected_as_rate_limited():
    response = {"code": 429, "message": "Too Many Requests"}
    assert rpc.is_rate_limited(response) is True


def test_normal_array_response_is_not_rate_limited():
    response = [{"jsonrpc": "2.0", "id": 1, "result": "0x1"}]
    assert rpc.is_rate_limited(response) is False


def test_single_object_non_429_error_is_not_treated_as_rate_limit():
    response = {"code": 500, "message": "Internal Server Error"}
    assert rpc.is_rate_limited(response) is False


# --- batch client: size, pacing, retry/backoff on 429 -------------------------
def test_call_batch_never_sends_more_than_max_batch_requests_at_once(monkeypatch):
    monkeypatch.setattr(rpc.time, "sleep", lambda *_: None)
    seen_batch_sizes = []

    def transport(payload):
        seen_batch_sizes.append(len(payload))
        return [{"jsonrpc": "2.0", "id": r["id"], "result": "0x1"} for r in payload]

    client = rpc.RpcClient(url="https://example.invalid", transport=transport)
    requests = [{"method": "eth_getBlockByNumber", "params": [hex(i), False]} for i in range(120)]
    results = client.call_batch(requests)

    assert len(results) == 120
    assert all(size <= 50 for size in seen_batch_sizes)
    assert max(seen_batch_sizes) == 50  # MAX_BATCH=50 is fully used, not under-batched


def test_call_batch_paces_between_batches(monkeypatch):
    sleep_calls = []
    monkeypatch.setattr(rpc.time, "sleep", lambda s: sleep_calls.append(s))

    def transport(payload):
        return [{"jsonrpc": "2.0", "id": r["id"], "result": "0x1"} for r in payload]

    client = rpc.RpcClient(url="https://example.invalid", transport=transport)
    requests = [{"method": "eth_call", "params": []} for _ in range(101)]  # 3 batches of <=50
    client.call_batch(requests)

    assert len(sleep_calls) >= 2  # paced between at least 2 of the 3 batches
    assert all(s >= 2.0 for s in sleep_calls)


def test_call_batch_retries_on_429_object_instead_of_raising_parse_error(monkeypatch):
    monkeypatch.setattr(rpc.time, "sleep", lambda *_: None)
    call_count = {"n": 0}

    def transport(payload):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"code": 429, "message": "Too Many Requests"}
        return [{"jsonrpc": "2.0", "id": r["id"], "result": "0x1"} for r in payload]

    client = rpc.RpcClient(url="https://example.invalid", transport=transport)
    results = client.call_batch([{"method": "eth_call", "params": []}])

    assert call_count["n"] == 2  # first 429, then a retry that succeeds
    assert len(results) == 1


def test_call_batch_gives_up_after_repeated_429s_and_raises(monkeypatch):
    monkeypatch.setattr(rpc.time, "sleep", lambda *_: None)

    def always_429(payload):
        return {"code": 429, "message": "Too Many Requests"}

    client = rpc.RpcClient(url="https://example.invalid", transport=always_429)
    with pytest.raises(Exception):
        client.call_batch([{"method": "eth_call", "params": []}])


def test_call_batch_backoff_increases_between_retries(monkeypatch):
    sleep_calls = []
    monkeypatch.setattr(rpc.time, "sleep", lambda s: sleep_calls.append(s))
    responses = iter(
        [
            {"code": 429, "message": "Too Many Requests"},
            {"code": 429, "message": "Too Many Requests"},
            [{"jsonrpc": "2.0", "id": 1, "result": "0x1"}],
        ]
    )

    def transport(payload):
        return next(responses)

    client = rpc.RpcClient(url="https://example.invalid", transport=transport)
    client.call_batch([{"method": "eth_call", "params": []}])

    backoff_sleeps = [s for s in sleep_calls if s > 0]
    assert len(backoff_sleeps) >= 2
    assert backoff_sleeps[1] > backoff_sleeps[0]  # exponential-style backoff, not constant
