"""One search surface, four strategies (spec/30 + spec/50): keyword always,
semantic when T2 is fresh, RRF fusion under auto, honest degradation markers."""
from __future__ import annotations

from typing import Callable

from brainpick.query.keyword import search as keyword_search

KNOWN_MODES = ("auto", "keyword", "semantic", "graph")
RRF_K = 60  # spec/30: reciprocal rank fusion constant

SemanticFn = Callable[[str, int], list[dict]]


def resolve_mode(mode) -> str:
    """Unknown modes fall back to auto — never an error (spec/50)."""
    mode = str(mode or "auto")
    return mode if mode in KNOWN_MODES else "auto"


def rrf_fuse(rankings: dict[str, list[dict]], limit: int) -> list[dict]:
    """RRF (k=60) across retrievers, deduped by document. A hit keeps the fields
    of the retriever contributing its best rank — that retriever is its source."""
    scores: dict[str, float] = {}
    best: dict[str, tuple[int, dict]] = {}  # path -> (best rank, that retriever's hit)
    for hits in rankings.values():
        for rank, hit in enumerate(hits, start=1):
            path = hit["path"]
            scores[path] = scores.get(path, 0.0) + 1.0 / (RRF_K + rank)
            if path not in best or rank < best[path][0]:
                best[path] = (rank, hit)

    fused = []
    for path in sorted(scores, key=lambda p: (-scores[p], p)):
        hit = dict(best[path][1])
        hit["score"] = round(scores[path], 6)
        fused.append(hit)
    return fused[:limit]


def run_search(
    records: list[dict],
    tiers: dict,
    query: str,
    mode: str = "auto",
    limit: int = 8,
    semantic_fn: SemanticFn | None = None,
) -> dict:
    """The spec/50 response body: {"hits", "used_modes", "degraded_from"}.

    `semantic_fn(query, limit)` runs the vector retriever; callers wire it to
    query.vectors.semantic_search. Any semantic failure degrades to keyword —
    a missing tier downgrades the answer, never errors the call.
    """
    resolved = resolve_mode(mode)
    t2_fresh = tiers.get("t2") == "fresh" and semantic_fn is not None

    if resolved == "keyword":
        return _body(keyword_search(records, query, limit=limit), ["keyword"], None)
    if resolved == "graph":  # the entity layer lands with T3 — keyword meanwhile
        return _body(keyword_search(records, query, limit=limit), ["keyword"], "graph")

    semantic_hits: list[dict] | None = None
    if t2_fresh:
        try:
            semantic_hits = semantic_fn(query, limit)
        except Exception:
            semantic_hits = None  # degrade below; T2 trouble must never error a search

    if resolved == "semantic":
        if semantic_hits is None:
            return _body(keyword_search(records, query, limit=limit), ["keyword"], "semantic")
        return _body(semantic_hits, ["semantic"], None)

    # auto: fuse whatever is available (spec/30: RRF k=60, dedupe by document)
    keyword_hits = keyword_search(records, query, limit=limit)
    if semantic_hits is None:
        return _body(keyword_hits, ["keyword"], "semantic")
    fused = rrf_fuse({"keyword": keyword_hits, "semantic": semantic_hits}, limit)
    return _body(fused, ["keyword", "semantic"], None)


def _body(hits: list[dict], used_modes: list[str], degraded_from: str | None) -> dict:
    return {"hits": hits, "used_modes": used_modes, "degraded_from": degraded_from}
