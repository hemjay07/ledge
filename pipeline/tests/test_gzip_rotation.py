"""
pipeline/crawl.py — daily partition gzip rotation (ARCHITECTURE.md §5).

Binding rules:
  - The current UTC day's partition stays plain text.
  - At the start of each run, any partition older than today is rewritten
    as `YYYY-MM-DD.jsonl.gz` and the plain file deleted.
  - Gzip must be deterministic: gzip.GzipFile(filename="", mtime=0,
    compresslevel=9) -- re-running the rotation is a no-op (idempotent,
    byte-identical output).
  - Loaders (recompute.py) accept both extensions.
"""
import gzip
import json
from datetime import date

from pipeline import crawl


def _write_plain(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def test_rotation_gzips_partitions_older_than_today(tmp_path):
    today = date(2026, 9, 6)
    old_path = tmp_path / "launches" / "2026-09-05.jsonl"
    _write_plain(old_path, [{"token": "0x1"}])

    crawl.rotate_partitions(tmp_path, today=today)

    assert not old_path.exists()
    assert (tmp_path / "launches" / "2026-09-05.jsonl.gz").exists()


def test_rotation_leaves_current_day_partition_plain(tmp_path):
    today = date(2026, 9, 6)
    current_path = tmp_path / "launches" / "2026-09-06.jsonl"
    _write_plain(current_path, [{"token": "0x1"}])

    crawl.rotate_partitions(tmp_path, today=today)

    assert current_path.exists()
    assert not (tmp_path / "launches" / "2026-09-06.jsonl.gz").exists()


def test_rotation_preserves_record_content(tmp_path):
    today = date(2026, 9, 6)
    records = [{"token": "0xA", "block": 1}, {"token": "0xB", "block": 2}]
    old_path = tmp_path / "graduations" / "2026-09-01.jsonl"
    _write_plain(old_path, records)

    crawl.rotate_partitions(tmp_path, today=today)

    gz_path = tmp_path / "graduations" / "2026-09-01.jsonl.gz"
    with gzip.open(gz_path, "rt") as f:
        lines = [json.loads(line) for line in f if line.strip()]
    assert lines == records


def test_rotation_is_deterministic_mtime_zero(tmp_path):
    today = date(2026, 9, 6)
    old_path = tmp_path / "launches" / "2026-09-04.jsonl"
    _write_plain(old_path, [{"token": "0x1"}])

    crawl.rotate_partitions(tmp_path, today=today)
    gz_path = tmp_path / "launches" / "2026-09-04.jsonl.gz"
    first_bytes = gz_path.read_bytes()

    # Rebuild an identical plain source and rotate again into a fresh dir --
    # byte-for-byte identical gzip output proves mtime=0 determinism.
    other_dir = tmp_path.parent / "rotation-repeat"
    other_old_path = other_dir / "launches" / "2026-09-04.jsonl"
    _write_plain(other_old_path, [{"token": "0x1"}])
    crawl.rotate_partitions(other_dir, today=today)
    second_bytes = (other_dir / "launches" / "2026-09-04.jsonl.gz").read_bytes()

    assert first_bytes == second_bytes


def test_rotation_is_a_no_op_when_rerun_on_already_gzipped_partition(tmp_path):
    today = date(2026, 9, 6)
    old_path = tmp_path / "launches" / "2026-09-03.jsonl"
    _write_plain(old_path, [{"token": "0x1"}])

    crawl.rotate_partitions(tmp_path, today=today)
    gz_path = tmp_path / "launches" / "2026-09-03.jsonl.gz"
    first_bytes = gz_path.read_bytes()

    crawl.rotate_partitions(tmp_path, today=today)  # rerun, nothing plain left to rotate
    second_bytes = gz_path.read_bytes()

    assert first_bytes == second_bytes


def test_rotation_handles_multiple_old_partitions_independently(tmp_path):
    today = date(2026, 9, 6)
    for day in ("2026-09-01", "2026-09-02", "2026-09-03"):
        _write_plain(tmp_path / "launches" / f"{day}.jsonl", [{"token": day}])

    crawl.rotate_partitions(tmp_path, today=today)

    for day in ("2026-09-01", "2026-09-02", "2026-09-03"):
        assert (tmp_path / "launches" / f"{day}.jsonl.gz").exists()
        assert not (tmp_path / "launches" / f"{day}.jsonl").exists()
