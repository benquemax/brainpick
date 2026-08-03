"""Similarity gaps (spec/45): T2 vectors joined against T1's link graph to
surface semantically-similar, unlinked document pairs — the second of the
two routes that replace LLM extraction (see ADR: the similarity
gap-detector). Advisory, like timeline.json (spec/90): it never blocks
compile, and consumers must tolerate its absence."""
from __future__ import annotations

import math
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10
    import tomli as tomllib

from brainpick.core.canonical import canonical_json
from brainpick.core.fs import write_if_changed
from brainpick.vectorstore import VectorStore

ALLOWLIST_FILE = "similarity-gaps-allowlist.toml"


def similarity_gaps_gate(config, t2_status: str) -> tuple[bool, str | None]:
    """(enabled, instruction) per [modules] similarity_gaps (spec/45, spec/80).
    "auto" (default) and "on" both ride T2 for free — absent T2 there is
    nothing to compute yet, not a missing prerequisite, so there is never an
    enabling instruction (unlike T2/T3's own gates)."""
    mode = str(config.modules.similarity_gaps or "").strip().lower()
    if mode == "off":
        return False, None
    return t2_status == "fresh", None


def read_allowlist(root: Path) -> set[tuple[str, str]]:
    """Reviewed-and-rejected pairs (spec/45), canonical (a, b) with a < b.
    Tolerant of absence/malformed TOML — never raises, same forgiving
    posture as an unparseable brainpick.local.toml (spec/80)."""
    path = root / ALLOWLIST_FILE
    if not path.is_file():
        return set()
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError:
        return set()
    pairs: set[tuple[str, str]] = set()
    for entry in data.get("dismissed", []) or []:
        if not isinstance(entry, dict):
            continue
        a, b = str(entry.get("a", "")), str(entry.get("b", ""))
        if not a or not b:
            continue
        pairs.add((a, b) if a < b else (b, a))
    return pairs


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _adjacency(graph: dict) -> dict[str, set[str]]:
    """The same undirected adjacency `_islands` builds (compile/t1.py) — a
    pair with an edge in either direction is "already linked", regardless of
    edge kind."""
    adjacency: dict[str, set[str]] = {}
    for edge in graph.get("edges", []):
        adjacency.setdefault(edge["source"], set()).add(edge["target"])
        adjacency.setdefault(edge["target"], set()).add(edge["source"])
    return adjacency


def compute_pairs(
    doc_vectors: dict[str, list[float]],
    graph: dict,
    reserved: set[str],
    threshold: float,
    max_pairs: int,
    dismissed: set[tuple[str, str]],
) -> list[dict]:
    """The spec/45 generation algorithm, pure (no I/O) — TDD-friendly."""
    adjacency = _adjacency(graph)
    docs = sorted(d for d in doc_vectors if d not in reserved)
    pairs: list[dict] = []
    for i, a in enumerate(docs):
        for b in docs[i + 1:]:
            if b in adjacency.get(a, ()):
                continue
            score = round(_cosine(doc_vectors[a], doc_vectors[b]), 3)
            if score < threshold:
                continue
            status = "dismissed" if (a, b) in dismissed else "open"
            pairs.append({"a": a, "b": b, "score": score, "status": status})
    pairs.sort(key=lambda p: (-p["score"], p["a"], p["b"]))
    return pairs[:max_pairs]


def run_similarity_gaps_stage(
    bp: Path, root: Path, graph: dict, records: list[dict], config,
) -> dict:
    """Compute + write .brainpick/t1/similarity-gaps.json. The caller
    (compile/pipeline.py) wraps this in try/except, matching
    _write_timeline's never-block-compile posture exactly."""
    store = VectorStore(bp / "t2" / "lancedb")
    doc_vectors = store.doc_vectors()
    reserved = {r["path"] for r in records if r["reserved"]}
    dismissed = read_allowlist(root)
    cfg = config.similarity_gaps
    pairs = compute_pairs(doc_vectors, graph, reserved, cfg.threshold, cfg.max_pairs, dismissed)
    result = {"pairs": pairs, "threshold": cfg.threshold, "max_pairs": cfg.max_pairs}
    write_if_changed(bp / "t1" / "similarity-gaps.json", canonical_json(result))
    return result
