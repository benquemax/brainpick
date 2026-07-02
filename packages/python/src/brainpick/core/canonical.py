"""Canonical serialization (spec/10) — what makes cross-runtime byte-golden real."""
from __future__ import annotations

import hashlib
import json


def canonical_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def canonical_jsonl(records: list[dict]) -> str:
    lines = [json.dumps(r, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for r in records]
    return "\n".join(lines) + "\n" if lines else ""


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
