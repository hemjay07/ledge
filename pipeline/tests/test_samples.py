"""
data/samples/*.json -> number.json["samples"]

A sample is a dated measurement with its own n: it is read once, by hand or by
a one-off script, and it does not move when the crawler runs. It is therefore
not a window and cannot be recomputed from the JSONL partitions. It is carried
into number.json verbatim, keyed by the name in its filename, so that every
figure the site prints still comes out of one published file.

Binding rules (CONSTRAINTS.md 3/4): a sample carries its own denominator and
its own measurement date, and nothing here invents either.
"""
import json
from pathlib import Path

import pytest

from pipeline.canonical import canonical_dumps
from pipeline import recompute as recompute_mod


RAISED_NOTHING = {
    "measuredAt": "2026-09-08",
    "sampled": 200,
    "count": 187,
    "share": 0.935,
    "method": "quote reserve read live from each launch's own bonding curve; matured launches only",
}


def _state_json():
    return {
        "version": 1, "firstIndexedBlock": 1000, "lastIndexedBlock": 2000,
        "reorgWindow": 3000, "lastRunAt": "2026-09-06T12:45:03Z",
        "lastSuccessAt": "2026-09-06T12:45:03Z", "consecutiveFailures": 0,
        "lastError": None,
        "counts": {"launches": 0, "graduations": 0, "orphanGraduations": 0,
                   "enrichmentFailures": 0},
    }


@pytest.fixture
def data_dir(tmp_path):
    (tmp_path / "launches").mkdir()
    (tmp_path / "graduations").mkdir()
    (tmp_path / "state.json").write_text(json.dumps(_state_json()))
    (tmp_path / "pair-tokens.json").write_text(json.dumps({}))
    return tmp_path


def _write_sample(data_dir: Path, name: str, body: dict):
    samples = data_dir / "samples"
    samples.mkdir(exist_ok=True)
    (samples / name).write_text(json.dumps(body))


# --- the absent case: older files must still parse -------------------------

def test_samples_is_an_empty_object_when_the_directory_is_absent(data_dir):
    assert not (data_dir / "samples").exists()
    result = recompute_mod.recompute(data_dir)
    assert result["samples"] == {}


def test_samples_is_an_empty_object_when_the_directory_is_empty(data_dir):
    (data_dir / "samples").mkdir()
    result = recompute_mod.recompute(data_dir)
    assert result["samples"] == {}


# --- the key ---------------------------------------------------------------

def test_sample_key_drops_the_date_and_camel_cases_the_name():
    assert recompute_mod.sample_key("raised-nothing-2026-09-08.json") == "raisedNothing"


def test_sample_key_leaves_an_undated_single_word_alone():
    assert recompute_mod.sample_key("reserves.json") == "reserves"


def test_sample_key_camel_cases_every_segment():
    assert recompute_mod.sample_key("quote-reserve-read-2026-01-02.json") == "quoteReserveRead"


# --- the published block ---------------------------------------------------

def test_recompute_emits_the_sample_verbatim_under_its_name(data_dir):
    _write_sample(data_dir, "raised-nothing-2026-09-08.json", RAISED_NOTHING)
    result = recompute_mod.recompute(data_dir)
    assert result["samples"]["raisedNothing"] == RAISED_NOTHING


def test_the_sample_keeps_its_own_denominator_and_date(data_dir):
    _write_sample(data_dir, "raised-nothing-2026-09-08.json", RAISED_NOTHING)
    sample = recompute_mod.recompute(data_dir)["samples"]["raisedNothing"]
    assert sample["sampled"] == 200
    assert sample["count"] == 187
    assert sample["measuredAt"] == "2026-09-08"


def test_every_file_in_the_directory_is_read(data_dir):
    _write_sample(data_dir, "raised-nothing-2026-09-08.json", RAISED_NOTHING)
    _write_sample(data_dir, "second-thing-2026-09-09.json", dict(RAISED_NOTHING, count=1))
    samples = recompute_mod.recompute(data_dir)["samples"]
    assert sorted(samples) == ["raisedNothing", "secondThing"]


def test_a_non_json_file_in_the_directory_is_not_a_sample(data_dir):
    _write_sample(data_dir, "raised-nothing-2026-09-08.json", RAISED_NOTHING)
    (data_dir / "samples" / "README.md").write_text("notes")
    assert list(recompute_mod.recompute(data_dir)["samples"]) == ["raisedNothing"]


def test_samples_survive_canonical_serialization_byte_for_byte(data_dir):
    _write_sample(data_dir, "raised-nothing-2026-09-08.json", RAISED_NOTHING)
    first = canonical_dumps(recompute_mod.recompute(data_dir))
    second = canonical_dumps(recompute_mod.recompute(data_dir))
    assert first == second
    assert '"raisedNothing"' in first


def test_the_committed_sample_file_is_the_one_the_task_specifies():
    """The published sample itself, read from the repo rather than a fixture."""
    path = Path(__file__).resolve().parents[2] / "data" / "samples" / "raised-nothing-2026-09-08.json"
    assert path.exists(), f"{path} is not committed"
    assert json.loads(path.read_text()) == RAISED_NOTHING
