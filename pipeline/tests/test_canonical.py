"""
pipeline/canonical.py — canonical_dumps(obj) -> str

Binding rules from ARCHITECTURE.md §8:
1. Every float is round(x, 6) before serialization.
2. sort_keys=True, indent=2, ensure_ascii=False, separators=(",", ": "),
   allow_nan=False.
3. -0.0 normalizes to 0.0; NaN/Infinity are impossible (allow_nan=False
   turns a bug into a crash -- i.e. raises rather than silently emitting
   NaN/Infinity literals).
4. Integers stay integers (never 1.0 where 1 is meant).
5. Key order is independent of construction order.
6. Ends with exactly one trailing newline.
7. Byte-identical across two runs on equivalent input.
"""
import json
import math

import pytest

from pipeline.canonical import canonical_dumps


def test_sorts_object_keys():
    out = canonical_dumps({"b": 1, "a": 2, "c": 0})
    parsed_order = [line.split(":")[0].strip().strip('"') for line in out.splitlines() if ":" in line]
    assert parsed_order == sorted(parsed_order)


def test_key_order_independent_of_construction_order():
    a = canonical_dumps({"z": 1, "a": {"y": 2, "b": 3}})
    b = canonical_dumps({"a": {"b": 3, "y": 2}, "z": 1})
    assert a == b


def test_rounds_floats_to_six_decimal_places():
    out = canonical_dumps({"rate": 0.0227164999})
    assert json.loads(out)["rate"] == round(0.0227164999, 6)


def test_integers_stay_integers_not_floats():
    out = canonical_dumps({"launches": 23552})
    assert '"launches": 23552' in out
    assert "23552.0" not in out


def test_negative_zero_normalizes_to_zero():
    out = canonical_dumps({"delta": -0.0})
    assert '"delta": 0.0' in out or '"delta": 0' in out
    assert "-0.0" not in out


def test_nan_is_rejected_not_silently_emitted():
    with pytest.raises(ValueError):
        canonical_dumps({"bad": float("nan")})


def test_infinity_is_rejected_not_silently_emitted():
    with pytest.raises(ValueError):
        canonical_dumps({"bad": float("inf")})


def test_ends_with_exactly_one_trailing_newline():
    out = canonical_dumps({"a": 1})
    assert out.endswith("\n")
    assert not out.endswith("\n\n")


def test_no_ascii_escaping_of_unicode():
    out = canonical_dumps({"label": "graduation — rate"})
    assert "—" in out
    assert "\\u2014" not in out


def test_byte_identical_across_two_runs_same_input():
    payload = {
        "schemaVersion": 1,
        "h24": {"rate": 0.022716, "launches": 23552, "graduations": 535},
    }
    first = canonical_dumps(json.loads(json.dumps(payload)))
    second = canonical_dumps(json.loads(json.dumps(payload)))
    assert first == second


def test_byte_identical_regardless_of_input_key_construction_order():
    payload_a = {"x": 1, "y": {"m": 1.0, "n": 2}}
    payload_b = {"y": {"n": 2, "m": 1.0}, "x": 1}
    assert canonical_dumps(payload_a) == canonical_dumps(payload_b)


def test_uses_two_space_indent_and_colon_space_separator():
    out = canonical_dumps({"a": 1, "b": {"c": 2}})
    assert '  "a": 1' in out
    assert '    "c": 2' in out


def test_nested_arrays_preserve_given_order_not_sorted():
    out = canonical_dumps({"buckets": ["eth", "stable", "stock", "other"]})
    parsed = json.loads(out)
    assert parsed["buckets"] == ["eth", "stable", "stock", "other"]
