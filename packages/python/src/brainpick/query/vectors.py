"""Semantic retrieval (spec/30): embed the query with the recorded backend,
cosine top-k over the chunk store, dedupe to documents (best chunk wins)."""
from __future__ import annotations

import json
import os
from pathlib import Path

from brainpick.embed import make_embedder
from brainpick.query.keyword import SNIPPET_WINDOW
from brainpick.vectorstore import VectorStore

_OVERFETCH = 4  # chunks per requested doc — several chunks may share a document


class SemanticUnavailable(Exception):
    """T2 artifacts are missing or unreadable — callers degrade to keyword."""


def load_embedding_record(bp: str | Path) -> dict:
    path = Path(bp) / "t2" / "embedding.json"
    if not path.is_file():
        raise SemanticUnavailable("t2/embedding.json is missing — run: brainpick compile")
    return json.loads(path.read_text(encoding="utf-8"))


def semantic_search(bp: str | Path, records: list[dict], query: str, limit: int = 8) -> list[dict]:
    """spec/50-shaped hits with source "semantic". Query-time embedding MUST use
    the t2/embedding.json record — that is how one engine searches vectors the
    other compiled."""
    bp = Path(bp)
    record = load_embedding_record(bp)
    embedder = make_embedder(
        record.get("kind", ""), record.get("endpoint", ""), record.get("model", ""),
        api_key=os.environ.get("OPENAI_API_KEY", ""),
    )
    [vector] = embedder.embed([query])
    if not any(vector):
        return []  # an all-zero query vector has no cosine neighborhood

    rows = VectorStore(bp / "t2" / "lancedb").query_vectors(
        vector, k=max(limit * _OVERFETCH, 32),
    )
    by_path = {r["path"]: r for r in records if not r["reserved"]}
    hits: list[dict] = []
    seen: set[str] = set()
    for row in rows:  # nearest first; the first chunk of a doc is its best chunk
        doc = row["doc"]
        if doc in seen:
            continue
        seen.add(doc)
        meta = by_path.get(doc)
        if meta is None:
            continue  # a vector for a doc that no longer exists — stale store, skip
        hits.append({
            "description": meta["description"],
            "path": doc,
            "score": round(1.0 - float(row.get("_distance", 0.0)), 6),
            "snippet": " ".join(row["text"][:SNIPPET_WINDOW].split()) or None,
            "source": "semantic",
            "title": meta["title"],
        })
        if len(hits) == limit:
            break
    return hits
