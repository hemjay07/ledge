"""
pipeline/recompute.py — jsonl -> number.json, --check, no network.

Binding rules (ARCHITECTURE.md §4/§5/§6/§8):
  - recompute() is a pure function of the raw data files. No network access
    at all: "the module asserts at import time that urllib.request is never
    called (the RPC client lives in pipeline/rpc.py and recompute.py does
    not import it)".
  - Reads both plain `.jsonl` and gzipped `.jsonl.gz` partitions.
  - `pairClass` in the launch record is a snapshot; recompute.py resolves
    pairClass fresh from `data/pair-tokens.json` by pairToken address, so
    reclassifying a symbol changes number.json's cohorts without touching
    a single JSONL byte.
  - Canonical output (round(x,6), sorted keys, trailing newline) is
    byte-identical across two runs of the same inputs.
  - `--check` diffs against the committed file and exits 1 on mismatch.
"""
import gzip
import json
import socket
import sys
from pathlib import Path

import pytest


def _write_jsonl(path: Path, records: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def _write_jsonl_gz(path: Path, records: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = "".join(json.dumps(r) + "\n" for r in records).encode()
    with open(path, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", mtime=0, fileobj=raw) as gz:
            gz.write(data)


def _launch(token, pair_token="0x0000000000000000000000000000000000000000",
            pair_class="eth", tax_bps=0, block=1000, ts=1_700_000_000, deployer="0xd0000000000000000000000000000000000001"):
    return {
        "token": token, "curve": "0xcurve0000000000000000000000000000000001",
        "deployer": deployer, "pairToken": pair_token, "pairClass": pair_class,
        "creatorTaxBps": tax_bps, "block": block, "ts": ts,
        "txHash": f"0x{block:064x}", "logIndex": 0,
    }


def _grad(token, block=1100, ts=1_700_000_100, amount="1000000000000000000"):
    return {
        "token": token, "block": block, "ts": ts, "pairTokenAmount": amount,
        "orphan": False, "txHash": f"0xg{block:063x}", "logIndex": 0,
    }


def _state_json(**overrides):
    state = {
        "version": 1, "firstIndexedBlock": 1000, "lastIndexedBlock": 2000,
        "reorgWindow": 3000, "lastRunAt": "2026-09-06T12:45:03Z",
        "lastSuccessAt": "2026-09-06T12:45:03Z", "consecutiveFailures": 0,
        "lastError": None,
        "counts": {"launches": 30, "graduations": 0, "orphanGraduations": 0, "enrichmentFailures": 0},
    }
    state.update(overrides)
    return state


@pytest.fixture
def data_dir(tmp_path):
    launches = [_launch(f"0xtok{i:037x}") for i in range(30)]
    _write_jsonl(tmp_path / "launches" / "2026-09-06.jsonl", launches)
    _write_jsonl(tmp_path / "graduations" / "2026-09-06.jsonl", [])
    (tmp_path / "state.json").write_text(json.dumps(_state_json()))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))
    return tmp_path


def test_recompute_module_does_not_import_rpc():
    import pipeline.recompute as recompute_mod
    assert not hasattr(recompute_mod, "rpc")
    assert "pipeline.rpc" not in {
        name for name, mod in sys.modules.items() if mod is getattr(recompute_mod, "rpc", None)
    }


def test_recompute_makes_no_socket_calls(monkeypatch, data_dir):
    from pipeline import recompute

    def _boom(*args, **kwargs):
        raise AssertionError("recompute.py must never open a network socket")

    monkeypatch.setattr(socket, "socket", _boom)
    result = recompute.recompute(data_dir)
    assert result is not None


def test_recompute_reads_plain_jsonl_partition(data_dir):
    from pipeline import recompute

    result = recompute.recompute(data_dir)
    assert result["allTime"]["launches"] == 30


def test_recompute_reads_gzipped_partition(tmp_path):
    from pipeline import recompute

    launches = [_launch(f"0xtok{i:037x}") for i in range(30)]
    _write_jsonl_gz(tmp_path / "launches" / "2026-09-05.jsonl.gz", launches)
    _write_jsonl(tmp_path / "graduations" / "2026-09-05.jsonl", [])
    (tmp_path / "state.json").write_text(json.dumps(_state_json()))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))

    result = recompute.recompute(tmp_path)
    assert result["allTime"]["launches"] == 30


def test_recompute_reads_both_plain_and_gz_partitions_together(tmp_path):
    from pipeline import recompute

    _write_jsonl_gz(tmp_path / "launches" / "2026-09-05.jsonl.gz", [_launch(f"0xold{i:036x}") for i in range(15)])
    _write_jsonl(tmp_path / "launches" / "2026-09-06.jsonl", [_launch(f"0xnew{i:036x}") for i in range(15)])
    _write_jsonl(tmp_path / "graduations" / "2026-09-06.jsonl", [])
    (tmp_path / "state.json").write_text(json.dumps(_state_json()))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))

    result = recompute.recompute(tmp_path)
    assert result["allTime"]["launches"] == 30


def test_recompute_output_is_byte_identical_across_two_runs(data_dir):
    from pipeline import recompute
    from pipeline.canonical import canonical_dumps

    first = canonical_dumps(recompute.recompute(data_dir))
    second = canonical_dumps(recompute.recompute(data_dir))
    assert first == second


def test_recompute_reclassifies_pair_token_without_touching_raw_records(tmp_path):
    from pipeline import recompute

    pair_token = "0xdeadbeef00000000000000000000000000dead"
    launches = [_launch(f"0xpt{i:038x}", pair_token=pair_token, pair_class="other") for i in range(30)]
    _write_jsonl(tmp_path / "launches" / "2026-09-06.jsonl", launches)
    _write_jsonl(tmp_path / "graduations" / "2026-09-06.jsonl", [])
    (tmp_path / "state.json").write_text(json.dumps(_state_json()))

    # Before classification: pairToken is unknown -> "other"
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))
    before = recompute.recompute(tmp_path)
    other_row_before = next(r for r in before["allTime"]["cohorts"]["pair"] if r["bucket"] == "other")
    assert other_row_before["launches"] == 30

    raw_bytes_before = (tmp_path / "launches" / "2026-09-06.jsonl").read_bytes()

    # Reclassify the symbol as "stable" in pair-tokens.json only.
    (tmp_path / "pair-tokens.json").write_text(
        json.dumps({pair_token: {"symbol": "USDX", "class": "stable"}})
    )
    after = recompute.recompute(tmp_path)
    stable_row_after = next(r for r in after["allTime"]["cohorts"]["pair"] if r["bucket"] == "stable")
    other_row_after = next(r for r in after["allTime"]["cohorts"]["pair"] if r["bucket"] == "other")
    assert stable_row_after["launches"] == 30
    assert other_row_after["launches"] == 0

    raw_bytes_after = (tmp_path / "launches" / "2026-09-06.jsonl").read_bytes()
    assert raw_bytes_before == raw_bytes_after


def test_recompute_unknown_pair_symbol_defaults_to_other(tmp_path):
    from pipeline import recompute

    pair_token = "0xunknownaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    launches = [_launch(f"0xu{i:039x}", pair_token=pair_token, pair_class="other") for i in range(30)]
    _write_jsonl(tmp_path / "launches" / "2026-09-06.jsonl", launches)
    _write_jsonl(tmp_path / "graduations" / "2026-09-06.jsonl", [])
    (tmp_path / "state.json").write_text(json.dumps(_state_json()))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))

    result = recompute.recompute(tmp_path)
    other_row = next(r for r in result["allTime"]["cohorts"]["pair"] if r["bucket"] == "other")
    assert other_row["launches"] == 30


def test_recompute_check_mode_exits_zero_when_file_matches(data_dir):
    from pipeline import recompute
    from pipeline.canonical import canonical_dumps

    out_path = data_dir / "number.json"
    computed = recompute.recompute(data_dir)
    out_path.write_text(canonical_dumps(computed))

    exit_code = recompute.main(["--data-dir", str(data_dir), "--out", str(out_path), "--check"])
    assert exit_code == 0


def test_recompute_check_mode_exits_nonzero_on_mismatch(data_dir):
    from pipeline import recompute

    out_path = data_dir / "number.json"
    out_path.write_text('{"schemaVersion": 999}\n')

    exit_code = recompute.main(["--data-dir", str(data_dir), "--out", str(out_path), "--check"])
    assert exit_code != 0


def test_recompute_writes_canonical_json_to_out_path(data_dir):
    from pipeline import recompute

    out_path = data_dir / "number.json"
    recompute.main(["--data-dir", str(data_dir), "--out", str(out_path)])
    assert out_path.exists()
    content = out_path.read_text()
    assert content.endswith("\n")
    assert not content.endswith("\n\n")
    parsed = json.loads(content)
    assert parsed["allTime"]["launches"] == 30
