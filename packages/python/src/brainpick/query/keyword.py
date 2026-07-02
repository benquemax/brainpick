"""Keyword retrieval: BM25 over docs.jsonl records (spec/50 — normative for
conformance). Depends on nothing beyond T1, so search works everywhere."""
from __future__ import annotations

import math
import re
from collections import Counter

_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
K1 = 1.2
B = 0.75
SNIPPET_WINDOW = 240


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def _searchable(record: dict) -> str:
    title, description = record["title"], record["description"] or ""
    return "\n".join([title, title, title, description, description, record["text"]])


def search(records: list[dict], query: str, limit: int = 8) -> list[dict]:
    corpus = [r for r in records if not r["reserved"]]
    if not corpus:
        return []

    term_freqs = [Counter(_tokens(_searchable(r))) for r in corpus]
    doc_lengths = [sum(tf.values()) for tf in term_freqs]
    avg_length = sum(doc_lengths) / len(doc_lengths) if corpus else 0.0

    query_terms = _tokens(query)
    if not query_terms or avg_length == 0:
        return []

    doc_count = len(corpus)
    doc_freq = {t: sum(1 for tf in term_freqs if tf[t] > 0) for t in set(query_terms)}

    hits = []
    for record, tf, dl in zip(corpus, term_freqs, doc_lengths):
        score = 0.0
        for term in query_terms:
            if tf[term] == 0:
                continue
            idf = math.log((doc_count - doc_freq[term] + 0.5) / (doc_freq[term] + 0.5) + 1)
            score += idf * (tf[term] * (K1 + 1)) / (tf[term] + K1 * (1 - B + B * dl / avg_length))
        if score > 0:
            hits.append({
                "description": record["description"],
                "path": record["path"],
                "score": round(score, 6),
                "snippet": _snippet(record["text"], query_terms),
                "source": "keyword",
                "title": record["title"],
            })

    hits.sort(key=lambda h: (-h["score"], h["path"]))
    return hits[:limit]


def _snippet(text: str, query_terms: list[str]) -> str | None:
    lowered = text.lower()
    first = min((i for i in (lowered.find(t) for t in query_terms) if i != -1), default=-1)
    if first == -1:
        return None
    start = max(0, first - 60)
    return " ".join(text[start : start + SNIPPET_WINDOW].split())
