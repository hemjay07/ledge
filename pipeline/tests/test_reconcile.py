"""
pipeline/reconcile.py — gate 7, the nightly D1-vs-repo divergence check.

ARCHITECTURE-PHASE2-4.md §9: "Compares D1's 24 h launch count and graduation
count against the committed partitions for the same window; a divergence
above 0.5% opens an issue. This is the only detector for a silently wrong
minute indexer."

The two indexers share nothing but the chain (§2). They dedupe on the same
key — `(txHash, logIndex)` — so the check is not only "are the counts close"
but "are they the same events": a Worker that dropped 40 launches and
double-counted 40 others has a divergence of zero and is still broken.

The one disagreement that is STRUCTURAL and must not be reported as a fault:
the hourly Python lags the minute Worker by up to an hour (§2), so the window
ends at the repo's own `crawledAt`. Anything the Worker saw after the repo's
last crawl is not a divergence, it is the lag the architecture disclosed.
"""
import json

import pytest

from pipeline import reconcile


def d1_row(token: str, ts: int, tx: str = None, log_index: int = 0, block: int = 100) -> dict:
    return {
        "token": token,
        "block": block,
        "ts": ts,
        "tx_hash": tx or f"0x{token[-4:]}aa",
        "log_index": log_index,
    }


def repo_row(token: str, ts: int, tx: str = None, log_index: int = 0, block: int = 100) -> dict:
    return {
        "token": token,
        "block": block,
        "ts": ts,
        "txHash": tx or f"0x{token[-4:]}aa",
        "logIndex": log_index,
    }


def rows(prefix: str, count: int, ts: int, maker) -> list[dict]:
    return [maker(f"0xtok{prefix}{i:04d}", ts + i) for i in range(count)]


# --- reading what wrangler hands back ---------------------------------------
def test_reads_the_shape_wrangler_d1_execute_json_returns():
    payload = [{"results": [{"token": "0xa", "ts": 5}], "success": True, "meta": {}}]
    assert reconcile.load_rows(payload) == [{"token": "0xa", "ts": 5}]


def test_reads_a_single_result_object_and_a_bare_list():
    assert reconcile.load_rows({"results": [{"token": "0xa"}]}) == [{"token": "0xa"}]
    assert reconcile.load_rows([{"token": "0xa"}]) == [{"token": "0xa"}]
    assert reconcile.load_rows({"rows": [{"token": "0xa"}]}) == [{"token": "0xa"}]


def test_an_empty_export_reads_as_no_rows_not_as_an_error():
    assert reconcile.load_rows([{"results": [], "success": True}]) == []
    assert reconcile.load_rows([]) == []


def test_a_payload_that_is_not_rows_at_all_is_refused():
    with pytest.raises(ValueError):
        reconcile.load_rows("nope")


# --- the dedupe key both indexers agreed on ---------------------------------
def test_the_key_is_tx_hash_and_log_index_in_either_spelling():
    assert reconcile.dedupe_key(repo_row("0xtoka", 5, tx="0xAB", log_index=2)) == ("0xab", 2)
    assert reconcile.dedupe_key(d1_row("0xtoka", 5, tx="0xAB", log_index=2)) == ("0xab", 2)


def test_a_row_with_no_key_is_refused_rather_than_silently_matched():
    with pytest.raises(KeyError):
        reconcile.dedupe_key({"token": "0xa", "ts": 1})


# --- the window -------------------------------------------------------------
def test_the_window_is_half_open_like_every_other_window_in_this_codebase():
    sample = [repo_row("0xtok0001", 100), repo_row("0xtok0002", 200), repo_row("0xtok0003", 300)]
    selected = reconcile.select(sample, since=100, until=300)
    assert [r["ts"] for r in selected] == [100, 200]


def test_rows_the_worker_saw_after_the_repos_last_crawl_are_out_of_scope():
    # the structural lag of section 2, which must not read as a fault
    d1 = [d1_row("0xtok0001", 100), d1_row("0xtok0002", 999)]
    repo = [repo_row("0xtok0001", 100)]
    result = reconcile.reconcile(repo, [], d1, [], since=0, until=500)
    assert result["launches"]["d1"] == 1
    assert result["launches"]["divergence"] == 0.0
    assert result["ok"] is True


# --- divergence -------------------------------------------------------------
def test_divergence_is_the_difference_over_the_repos_count():
    assert reconcile.divergence(1000, 1000) == 0.0
    assert reconcile.divergence(1000, 995) == 0.005
    assert reconcile.divergence(1000, 1005) == 0.005


def test_two_empty_windows_agree_and_a_lone_d1_row_does_not():
    assert reconcile.divergence(0, 0) == 0.0
    assert reconcile.divergence(0, 3) == 1.0


def test_exactly_the_threshold_passes_and_a_hair_over_it_fails():
    repo = rows("L", 1000, 1_000_000, repo_row)
    on_threshold = reconcile.reconcile(repo, [], reconcile_d1(repo, drop=5), [], 0, 9_999_999)
    assert on_threshold["launches"]["divergence"] == 0.005
    assert on_threshold["ok"] is True

    over = reconcile.reconcile(repo, [], reconcile_d1(repo, drop=6), [], 0, 9_999_999)
    assert over["launches"]["divergence"] > reconcile.MAX_DIVERGENCE
    assert over["ok"] is False


def reconcile_d1(repo: list[dict], drop: int = 0) -> list[dict]:
    """The same events as the repo, as D1 would spell them, minus `drop`."""
    kept = repo[: len(repo) - drop] if drop else repo
    return [
        {
            "token": r["token"],
            "block": r["block"],
            "ts": r["ts"],
            "tx_hash": r["txHash"],
            "log_index": r["logIndex"],
        }
        for r in kept
    ]


# --- the check that a count alone cannot make -------------------------------
def test_equal_counts_over_different_events_is_still_a_divergence():
    """A Worker that dropped 40 and double-counted 40 others has a count
    divergence of zero. The key sets are what catch it."""
    repo = rows("L", 100, 1_000_000, repo_row)
    d1 = reconcile_d1(repo)
    # swap ten events for ten the repo never saw, keeping the count identical
    for i in range(10):
        d1[i] = {**d1[i], "tx_hash": f"0xghost{i:02d}", "token": f"0xghost{i:02d}"}

    result = reconcile.reconcile(repo, [], d1, [], 0, 9_999_999)
    assert result["launches"]["repo"] == result["launches"]["d1"] == 100
    assert result["launches"]["divergence"] == 0.0
    assert result["launches"]["onlyInRepo"] == 10
    assert result["launches"]["onlyInD1"] == 10
    # 10 missing + 10 phantom: the symmetric difference is 20 of 100 keys
    assert result["launches"]["keyDivergence"] == 0.2
    assert result["ok"] is False


def test_graduations_are_reconciled_on_the_same_terms_as_launches():
    grads = rows("G", 200, 1_000_000, repo_row)
    result = reconcile.reconcile([], grads, [], reconcile_d1(grads, drop=40), 0, 9_999_999)
    assert result["graduations"]["repo"] == 200
    assert result["graduations"]["d1"] == 160
    assert result["graduations"]["divergence"] == 0.2
    assert result["ok"] is False


def test_a_clean_night_reports_ok_on_both_tables():
    launches = rows("L", 500, 1_000_000, repo_row)
    grads = rows("G", 20, 1_000_000, repo_row)
    result = reconcile.reconcile(
        launches, grads, reconcile_d1(launches), reconcile_d1(grads), 0, 9_999_999
    )
    assert result["ok"] is True
    assert result["maxDivergence"] == 0.0
    for table in ("launches", "graduations"):
        assert result[table]["onlyInRepo"] == 0
        assert result[table]["onlyInD1"] == 0


# --- the summary that reaches the job log -----------------------------------
def test_the_summary_names_both_counts_and_the_threshold():
    launches = rows("L", 500, 1_000_000, repo_row)
    result = reconcile.reconcile(launches, [], reconcile_d1(launches, drop=50), [], 0, 9_999_999)
    summary = reconcile.format_summary(result)
    assert "launches" in summary
    assert "500" in summary and "450" in summary
    assert "0.5" in summary  # the threshold, stated wherever the verdict is
    assert "FAIL" in summary


def test_the_summary_of_a_clean_night_says_so_without_a_verdict_word():
    result = reconcile.reconcile([], [], [], [], 0, 9_999_999)
    assert "OK" in reconcile.format_summary(result)


# --- the command ------------------------------------------------------------
def _write(tmp_path, name, payload):
    path = tmp_path / name
    path.write_text(json.dumps(payload))
    return str(path)


def test_main_exits_zero_when_the_two_indexers_agree(tmp_path, monkeypatch):
    launches = rows("L", 100, 1_000_000, repo_row)
    monkeypatch.setattr(
        reconcile, "load_repo", lambda data_dir: (launches, [], "1970-01-13T13:46:40Z")
    )
    code = reconcile.main(
        [
            "--d1-launches",
            _write(tmp_path, "l.json", [{"results": reconcile_d1(launches)}]),
            "--d1-graduations",
            _write(tmp_path, "g.json", [{"results": []}]),
            "--window-seconds",
            "86400",
        ]
    )
    assert code == 0


def test_main_exits_one_above_the_threshold(tmp_path, monkeypatch):
    launches = rows("L", 100, 1_000_000, repo_row)
    monkeypatch.setattr(
        reconcile, "load_repo", lambda data_dir: (launches, [], "1970-01-13T13:46:40Z")
    )
    code = reconcile.main(
        [
            "--d1-launches",
            _write(tmp_path, "l.json", [{"results": reconcile_d1(launches, drop=40)}]),
            "--d1-graduations",
            _write(tmp_path, "g.json", [{"results": []}]),
        ]
    )
    assert code == 1


def test_main_writes_the_summary_where_the_workflow_can_post_it(tmp_path, monkeypatch):
    launches = rows("L", 100, 1_000_000, repo_row)
    monkeypatch.setattr(
        reconcile, "load_repo", lambda data_dir: (launches, [], "1970-01-13T13:46:40Z")
    )
    out = tmp_path / "summary.md"
    reconcile.main(
        [
            "--d1-launches",
            _write(tmp_path, "l.json", [{"results": reconcile_d1(launches)}]),
            "--d1-graduations",
            _write(tmp_path, "g.json", [{"results": []}]),
            "--summary-out",
            str(out),
        ]
    )
    written = out.read_text()
    assert "launches" in written
    # the window actually held the rows: a vacuous [empty vs empty] run would
    # also exit 0, and would prove nothing about the reconciliation
    assert "100" in written
    assert "OK" in written
