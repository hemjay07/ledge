"""Canonical JSON serialization. Binding rules: ARCHITECTURE.md section 8.

Every number.json byte is produced through canonical_dumps so the CI
recompute diff is byte-for-byte reproducible across machines and runs.
"""
from __future__ import annotations

import json
from typing import Any


def _normalize(obj: Any) -> Any:
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        value = round(obj, 6)
        if value == 0.0:
            value = 0.0  # collapses -0.0 to 0.0
        return value
    if isinstance(obj, dict):
        return {k: _normalize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_normalize(v) for v in obj]
    return obj


def canonical_dumps(obj: Any) -> str:
    """Serialize obj as sorted, indented, reproducible JSON plus one newline."""
    normalized = _normalize(obj)
    return (
        json.dumps(
            normalized,
            sort_keys=True,
            indent=2,
            ensure_ascii=False,
            separators=(",", ": "),
            allow_nan=False,
        )
        + "\n"
    )
