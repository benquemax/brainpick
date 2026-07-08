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


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def _searchable(record: dict) -> str:
    title, description = record["title"], record["description"] or ""
    return "\n".join([title, title, title, description, description, record["text"]])


def search(records: list[dict], query: str, limit: int = 8) -> list[dict]:
    corpus = [r for r in records if not r["reserved"]]
    if not corpus:
        return []

    term_freqs = [Counter(tokenize(_searchable(r))) for r in corpus]
    doc_lengths = [sum(tf.values()) for tf in term_freqs]
    avg_length = sum(doc_lengths) / len(doc_lengths) if corpus else 0.0

    query_terms = tokenize(query)
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


def _covers(query_token: str, title_token: str) -> bool:
    """Does a TITLE token account for a query token? Exact, or a short prefix-stem so a
    simple inflection reaches its stem ('agents'→'agent', 'connects'→'connect') without
    stemming machinery — bounded to a ±2 length prefix so it never over-fires (e.g.
    'auth' does NOT swallow 'authentication')."""
    if query_token == title_token:
        return True
    if len(query_token) >= 4 and len(title_token) >= 4 and abs(len(query_token) - len(title_token)) <= 2:
        return query_token.startswith(title_token) or title_token.startswith(query_token)
    return False


def title_search(records: list[dict], query: str, limit: int = 8) -> list[dict]:
    """Docs whose TITLE the query names — a deterministic T1 navigational signal so
    typing an article's name always finds that article (in every mode). A doc qualifies
    only when EVERY query token is covered by some title token (exact or short
    prefix-stem), so 'cli'→'CLI reference' and 'agents'→'Agent integrations' match while
    an unrelated word does not. Ranked exact-title first, then the tightest (fewest
    extra title tokens), then path — deterministic across engines."""
    q_tokens = tokenize(query)
    if not q_tokens:
        return []
    q_unique = list(dict.fromkeys(q_tokens))
    scored: list[tuple[int, int, dict]] = []
    for record in records:
        if record["reserved"]:
            continue
        t_tokens = tokenize(record["title"])
        if not t_tokens:
            continue
        if not all(any(_covers(q, t) for t in t_tokens) for q in q_unique):
            continue
        exact = 1 if t_tokens == q_tokens else 0
        scored.append((exact, len(t_tokens), record))
    scored.sort(key=lambda s: (-s[0], s[1], s[2]["path"]))
    hits: list[dict] = []
    for exact, _ntok, record in scored[:limit]:
        hits.append({
            "description": record["description"],
            "path": record["path"],
            "score": round(1.0 + exact, 6),  # 2.0 for an exact title, 1.0 otherwise
            "snippet": None,
            "source": "title",
            "title": record["title"],
        })
    return hits
