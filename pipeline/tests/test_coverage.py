"""The live index's coverage figure (INDEXER.md section 3, TODO A4): of a
sample of launches the canonical record holds for the last 24 hours, how
many the live index (D1 token_activity) has a row for, and for how many it
read the launch block. Class B, about our own index, outside stats.py, and
published with its n like everything else."""

from __future__ import annotations

import json

from pipeline import coverage


def _launch(i: int, ts: int) -> dict:
    return {"token": f"0x{i:040x}", "block": 1000 + i, "ts": ts}


def test_sampling_is_deterministic_and_capped(tmp_path):
    launches = [_launch(i, 100_000 + i) for i in range(1000)]
    a = coverage.sample(launches, 200)
    b = coverage.sample(launches, 200)
    assert a == b
    assert len(a) == 200
    assert a[0]["block"] < a[-1]["block"]  # spread over the window, not the first 200


def test_measures_presence_and_launch_block_reads():
    launches = [_launch(i, 100_000 + i) for i in range(40)]
    present = {l["token"]: (1 if i % 4 else None) for i, l in enumerate(launches[:30])}

    def query(tokens):
        return [{"token": t, "first_block_buyers": present[t]} for t in tokens if t in present]

    out = coverage.measure(launches, query, sampled=40, cursor_last_success_at=200_000, measured_at=200_060)
    assert out["sampled"] == 40
    assert out["present"] == 30
    assert out["presentShare"] == 0.75
    assert out["launchBlockRead"] == 22
    assert out["cursorAgeSeconds"] == 60
    assert out["window"] == "launches in the last 24 hours of the canonical record"


def test_shares_are_null_below_the_floor():
    launches = [_launch(i, 100_000 + i) for i in range(12)]
    out = coverage.measure(launches, lambda tokens: [], sampled=12, cursor_last_success_at=1, measured_at=1)
    assert out["sampled"] == 12
    assert out["present"] == 0
    assert out["presentShare"] is None
    assert out["insufficient"] is True


def test_writes_the_file_beside_number_json(tmp_path):
    (tmp_path / "launches").mkdir()
    (tmp_path / "launches" / "2026-09-14.jsonl").write_text(
        "\n".join(json.dumps(_launch(i, 1_789_400_000 + i)) for i in range(50)) + "\n"
    )
    (tmp_path / "state.json").write_text(json.dumps({"lastIndexedAt": "2026-09-14T16:00:00Z"}))
    coverage.run(tmp_path, lambda tokens: [{"token": t, "first_block_buyers": 0} for t in tokens], lambda: 1_789_404_000, now=1_789_404_100)
    doc = json.loads((tmp_path / "coverage.json").read_text())
    assert doc["sampled"] == 50 and doc["present"] == 50 and doc["presentShare"] == 1.0
    assert doc["measuredAt"].endswith("Z")
