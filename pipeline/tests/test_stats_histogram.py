"""
pipeline/stats.py — ttg_histogram(w) and the ttg block it ships inside.

Definition, binding:

    HISTOGRAM_EDGES is a fixed, ascending list of second marks, each about
    double the last. Like LADDER_EDGES it is a DEFINITION: moving an edge
    moves a published figure and needs a dated /method changelog entry
    (CONSTRAINTS.md #9).

    Each bucket is HALF-OPEN, [fromSeconds, toSeconds) — the same convention
    the windows use, so a graduation landing exactly on an edge belongs to
    the bucket above and is never counted twice.

    The final bucket carries `toSeconds: None` and holds the tail, so the
    counts always sum to n and no graduation falls outside the table. This is
    what separates a histogram from the ladder: the ladder's last rung can be
    below n because the tail is counted in no rung, and that is correct
    there. A histogram that dropped its tail would be a drawing missing part
    of its own record.

    `graduations` is always the raw count. `share` is null for every bucket
    when the block is insufficient (matched graduations < 30) — never 0.0,
    which would read as a measured finding (CONSTRAINTS.md #4).

The drawing on /graduated renders these bars from a zero baseline, so any
distortion here is a distortion of the one figure whose point is its shape.
"""
from pipeline.stats import HISTOGRAM_EDGES, MIN_N, ttg_block, ttg_histogram, window


def _build_window(make_launch, make_grad, deltas: list[int]):
    launches = []
    graduations = []
    for i, delta in enumerate(deltas):
        tok = f"0xL{i:039x}"
        launches.append(make_launch(token=tok, ts=0))
        graduations.append(make_grad(token=tok, ts=delta))
    return window(launches, graduations, since=None, until=10**12)


def test_histogram_edges_are_the_published_definition():
    assert HISTOGRAM_EDGES == (0, 2, 5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240)


def test_histogram_edges_ascend_strictly():
    assert list(HISTOGRAM_EDGES) == sorted(set(HISTOGRAM_EDGES))


def test_first_edge_is_zero_so_a_same_block_graduation_has_a_bucket(make_launch, make_grad):
    """A launch and a graduation in the same block differ by zero seconds. If
    the first edge were 1 that graduation would belong to no bucket, and it is
    precisely the case the drawing exists to show."""
    w = _build_window(make_launch, make_grad, [0] * 30)
    rows = ttg_histogram(w)
    assert rows[0]["fromSeconds"] == 0
    assert rows[0]["graduations"] == 30


def test_one_bucket_per_edge_in_edge_order(make_launch, make_grad):
    w = _build_window(make_launch, make_grad, list(range(1, 41)))
    rows = ttg_histogram(w)
    assert [r["fromSeconds"] for r in rows] == list(HISTOGRAM_EDGES)
    for row in rows:
        assert set(row) == {"fromSeconds", "toSeconds", "graduations", "share"}


def test_buckets_are_half_open_so_an_edge_value_lands_above(make_launch, make_grad):
    """40 graduations at exactly 5 s. The 2-5 s bucket must hold none of them
    and the 5-10 s bucket must hold all 40."""
    w = _build_window(make_launch, make_grad, [5] * 40)
    rows = {r["fromSeconds"]: r for r in ttg_histogram(w)}
    assert rows[2]["graduations"] == 0
    assert rows[5]["graduations"] == 40


def test_the_last_bucket_is_open_ended_and_holds_the_tail(make_launch, make_grad):
    deltas = [1] * 30 + [999_999, 500_000]
    w = _build_window(make_launch, make_grad, deltas)
    rows = ttg_histogram(w)
    assert rows[-1]["toSeconds"] is None
    assert rows[-1]["graduations"] == 2


def test_the_buckets_sum_to_n_so_no_graduation_is_dropped(make_launch, make_grad):
    deltas = [0, 1, 3, 7, 15, 33, 79, 150, 300, 600, 1200, 2000, 4000, 9000, 40_000]
    deltas = deltas * 3  # 45 graduations, spread across every bucket
    w = _build_window(make_launch, make_grad, deltas)
    rows = ttg_histogram(w)
    assert sum(r["graduations"] for r in rows) == len(deltas)


def test_shares_sum_to_one_within_rounding(make_launch, make_grad):
    deltas = [i for i in range(0, 200, 4)]  # 50 graduations
    w = _build_window(make_launch, make_grad, deltas)
    rows = ttg_histogram(w)
    assert abs(sum(r["share"] for r in rows) - 1.0) < 1e-6


def test_below_min_n_every_share_is_null_and_the_counts_survive(make_launch, make_grad):
    deltas = [1] * (MIN_N - 1)
    w = _build_window(make_launch, make_grad, deltas)
    rows = ttg_histogram(w)
    assert all(r["share"] is None for r in rows)
    # the raw counts are still published, so a reader can check for themselves
    assert sum(r["graduations"] for r in rows) == MIN_N - 1


def test_the_block_ships_the_histogram_under_the_same_gate(make_launch, make_grad):
    w = _build_window(make_launch, make_grad, list(range(1, 41)))
    block = ttg_block(w)
    assert "histogram" in block
    assert [r["fromSeconds"] for r in block["histogram"]] == list(HISTOGRAM_EDGES)
    assert block["insufficient"] is False


def test_an_empty_window_yields_every_bucket_at_zero(make_launch, make_grad):
    w = _build_window(make_launch, make_grad, [])
    rows = ttg_histogram(w)
    assert len(rows) == len(HISTOGRAM_EDGES)
    assert all(r["graduations"] == 0 and r["share"] is None for r in rows)
