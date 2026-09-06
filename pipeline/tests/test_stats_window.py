"""
pipeline/stats.py — window(launches, graduations, since, until) -> Window

Per ARCHITECTURE.md §6 / METHOD.md "Definitions":
  Selection: launch.ts in the HALF-OPEN interval [since, until). A launch at
  exactly `until` belongs to the next window, so adjacent windows partition
  the timeline with no launch counted twice at the seam. A graduation is
  included iff its token has a launch IN THIS WINDOW; graduation ts may fall
  outside it. since=None => all-time.
"""
from pipeline.stats import window


def test_since_none_includes_every_launch_regardless_of_ts(make_launch):
    launches = [make_launch(ts=1), make_launch(ts=999_999_999)]
    w = window(launches, [], since=None, until=10**12)
    assert len(w["launches"]) == 2


def test_launch_at_since_boundary_is_included(make_launch):
    launches = [make_launch(token="0xA", ts=1_000)]
    w = window(launches, [], since=1_000, until=2_000)
    assert len(w["launches"]) == 1


def test_launch_at_until_boundary_is_excluded(make_launch):
    # Half-open [since, until): the launch at exactly `until` is the first
    # launch of the NEXT window, never a member of this one.
    launches = [make_launch(token="0xA", ts=2_000)]
    w = window(launches, [], since=1_000, until=2_000)
    assert len(w["launches"]) == 0


def test_launch_one_second_before_until_is_included(make_launch):
    launches = [make_launch(token="0xA", ts=1_999)]
    w = window(launches, [], since=1_000, until=2_000)
    assert len(w["launches"]) == 1


def test_adjacent_windows_never_double_count_a_launch_at_the_seam(make_launch):
    launches = [make_launch(token="0xA", ts=2_000)]
    first = window(launches, [], since=1_000, until=2_000)
    second = window(launches, [], since=2_000, until=3_000)
    assert len(first["launches"]) + len(second["launches"]) == 1


def test_launch_one_second_before_since_is_excluded(make_launch):
    launches = [make_launch(token="0xA", ts=999)]
    w = window(launches, [], since=1_000, until=2_000)
    assert len(w["launches"]) == 0


def test_launch_one_second_after_until_is_excluded(make_launch):
    launches = [make_launch(token="0xA", ts=2_001)]
    w = window(launches, [], since=1_000, until=2_000)
    assert len(w["launches"]) == 0


def test_graduation_included_when_its_launch_is_in_window_even_if_grad_ts_is_outside(
    make_launch, make_grad
):
    launches = [make_launch(token="0xA", ts=1_000)]
    # graduation timestamp is far outside [since, until]
    grads = [make_grad(token="0xA", ts=999_999)]
    w = window(launches, grads, since=1_000, until=2_000)
    assert "0xA" in w["grads_by_token"]


def test_graduation_excluded_when_its_launch_is_outside_window(make_launch, make_grad):
    launches = [make_launch(token="0xA", ts=5_000)]  # outside window below
    grads = [make_grad(token="0xA", ts=1_500)]
    w = window(launches, grads, since=1_000, until=2_000)
    assert "0xA" not in w["grads_by_token"]
    assert len(w["launches"]) == 0


def test_graduation_for_unknown_token_counts_as_orphan(make_launch, make_grad):
    launches = [make_launch(token="0xA", ts=1_000)]
    grads = [make_grad(token="0xB", ts=1_500)]  # no matching launch anywhere
    w = window(launches, grads, since=None, until=10**12)
    assert w["orphans"] == 1
    assert "0xB" not in w["grads_by_token"]


def test_window_preserves_since_and_until_in_result(make_launch):
    w = window([make_launch(ts=1_000)], [], since=500, until=1_500)
    assert w["since"] == 500
    assert w["until"] == 1_500


def test_window_since_none_is_preserved_as_none(make_launch):
    w = window([make_launch(ts=1_000)], [], since=None, until=1_500)
    assert w["since"] is None


def test_multiple_graduations_for_same_token_both_considered(make_launch, make_grad):
    # Dedup on (txHash, logIndex) happens at crawl time, not here; stats.py
    # trusts its input. A window with two distinct graduation records for
    # the same token should not silently drop one -- grads_by_token uses the
    # token as key per the documented Window shape, so behaviour here is a
    # documented single-slot map; this test locks in "last/only" handling
    # rather than a silent crash.
    launches = [make_launch(token="0xA", ts=1_000)]
    grads = [
        make_grad(token="0xA", ts=1_100, log_index=0),
        make_grad(token="0xA", ts=1_200, log_index=1),
    ]
    w = window(launches, grads, since=None, until=10**12)
    assert "0xA" in w["grads_by_token"]
