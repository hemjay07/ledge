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


# --- W10: rotating onto an existing archive merges, never overwrites --------
def test_rotation_merges_new_plain_lines_into_an_existing_archive(tmp_path):
    """After an outage crossing midnight, day D is already `.jsonl.gz` when
    a new `D.jsonl` appears. Rotating must not replace the archive with the
    new fragment -- that silently deletes every earlier record of the day."""
    today = date(2026, 9, 6)
    archived = [{"token": "0xOLD1", "txHash": "0xa", "logIndex": 0},
                {"token": "0xOLD2", "txHash": "0xb", "logIndex": 0}]
    fresh = [{"token": "0xNEW", "txHash": "0xc", "logIndex": 0}]
    gz_path = tmp_path / "launches" / "2026-09-05.jsonl.gz"
    gz_path.parent.mkdir(parents=True)
    with gzip.open(gz_path, "wt") as f:
        f.write("".join(json.dumps(r) + "\n" for r in archived))
    _write_plain(tmp_path / "launches" / "2026-09-05.jsonl", fresh)

    crawl.rotate_partitions(tmp_path, today=today)

    with gzip.open(gz_path, "rt") as f:
        merged = [json.loads(line) for line in f if line.strip()]
    assert merged == archived + fresh
    assert not (tmp_path / "launches" / "2026-09-05.jsonl").exists()


def test_rotation_merge_dedupes_on_txhash_and_logindex(tmp_path):
    today = date(2026, 9, 6)
    archived = [{"token": "0xA", "txHash": "0xa", "logIndex": 0}]
    overlapping = [{"token": "0xA", "txHash": "0xa", "logIndex": 0},
                   {"token": "0xB", "txHash": "0xa", "logIndex": 1}]
    gz_path = tmp_path / "graduations" / "2026-09-04.jsonl.gz"
    gz_path.parent.mkdir(parents=True)
    with gzip.open(gz_path, "wt") as f:
        f.write("".join(json.dumps(r) + "\n" for r in archived))
    _write_plain(tmp_path / "graduations" / "2026-09-04.jsonl", overlapping)

    crawl.rotate_partitions(tmp_path, today=today)

    with gzip.open(gz_path, "rt") as f:
        merged = [json.loads(line) for line in f if line.strip()]
    assert merged == [{"token": "0xA", "txHash": "0xa", "logIndex": 0},
                      {"token": "0xB", "txHash": "0xa", "logIndex": 1}]


def test_merged_rotation_is_still_deterministic(tmp_path):
    today = date(2026, 9, 6)

    def _build(root):
        gz_path = root / "launches" / "2026-09-02.jsonl.gz"
        gz_path.parent.mkdir(parents=True)
        with gzip.open(gz_path, "wt") as f:
            f.write(json.dumps({"token": "0xA", "txHash": "0xa", "logIndex": 0}) + "\n")
        _write_plain(root / "launches" / "2026-09-02.jsonl",
                     [{"token": "0xB", "txHash": "0xb", "logIndex": 0}])
        crawl.rotate_partitions(root, today=today)
        return (root / "launches" / "2026-09-02.jsonl.gz").read_bytes()

    assert _build(tmp_path / "one") == _build(tmp_path / "two")
