"""T3 knowledge-graph query over the neutral export (spec/40).

This is the CONSUMER side of T3: it never extracts. It reads the hand-authored
`t3/{entities.jsonl,relations.jsonl,kg-meta.json}` export into an in-memory
graph and answers the two normative retrievals — entity-layer neighbors and
`mode=graph` search — plus the entity graph the UI's entity layer consumes.

Id normalization, the export layout, and the retrieval semantics are normative
(spec/40); the export *content* is advisory, so conformance tests this reader
against a fixture, never an extractor.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path

from brainpick.query.keyword import B, K1, search as keyword_search, tokenize

# Python str comparison is already Unicode-codepoint order (spec/40 "codepoint
# order"); the Node twin needs core.canonical.cmpStr to get the same from UTF-16.

# The alphanumeric run — the exact tokenizer keyword search uses (spec/50),
# so "run of non-alphanumeric characters" is byte-identical across engines.
_ALNUM = re.compile(r"[^\W_]+", re.UNICODE)

GRAPH_HOP_DECAY = 1.0  # a one-hop neighbor contributes its relation weight, undecayed
LINK_WALK_DECAY = 0.5  # a T1-link neighbor of a keyword hit ranks below it (graph degrade)


def normalize_entity_id(name: str) -> str:
    """spec/40 id: NFC, lowercased, every run of non-alphanumeric characters → "-",
    trimmed of "-". Splitting on the alphanumeric tokenizer and re-joining with "-"
    collapses runs and trims ends in one step — and reuses the cross-engine-proven
    keyword tokenizer, so Python and JS agree by construction."""
    folded = unicodedata.normalize("NFC", str(name)).lower()
    return "-".join(_ALNUM.findall(folded))


def disambiguate_ids(names: list[str]) -> dict[str, str]:
    """Distinct names that normalize to the same slug collide; the collision keeps
    the base slug for the codepoint-first name and appends -2, -3… to the rest, in
    `name` codepoint order (spec/40)."""
    groups: dict[str, list[str]] = {}
    for name in names:
        groups.setdefault(normalize_entity_id(name), []).append(name)
    assigned: dict[str, str] = {}
    for slug, group in groups.items():
        for index, name in enumerate(sorted(dict.fromkeys(group))):
            assigned[name] = slug if index == 0 else f"{slug}-{index + 1}"
    return assigned


class KnowledgeGraph:
    """The in-memory export: entities by id, undirected relation adjacency for
    walks, a doc→entities reverse index, and a BM25 view of entity text."""

    def __init__(self, entities: dict[str, dict], relations: list[dict], meta: dict):
        self.entities = entities
        self.relations = relations
        self.meta = meta

        self.adjacency: dict[str, list[tuple[str, float]]] = {eid: [] for eid in entities}
        for rel in relations:
            self.adjacency[rel["src"]].append((rel["dst"], float(rel["weight"])))
            self.adjacency[rel["dst"]].append((rel["src"], float(rel["weight"])))
        for eid in self.adjacency:  # neighbor id order is deterministic across engines
            self.adjacency[eid].sort(key=lambda pair: pair[0])

        self._by_doc: dict[str, list[str]] = {}
        for eid, entity in entities.items():
            for doc in entity.get("source_docs", []):
                self._by_doc.setdefault(doc, []).append(eid)
        for doc in self._by_doc:
            self._by_doc[doc].sort()

        # BM25 corpus over "name — description", one document per entity (spec/40:
        # match the query against entity names and descriptions).
        self._ids = sorted(entities)
        self._tokens = [tokenize(self._text(entities[eid])) for eid in self._ids]
        self._lengths = [len(toks) for toks in self._tokens]
        self._avg_len = (sum(self._lengths) / len(self._lengths)) if self._lengths else 0.0

    @staticmethod
    def _text(entity: dict) -> str:
        return f"{entity['name']} {entity.get('description') or ''}"

    def entities_for_doc(self, path: str) -> list[str]:
        """The entity ids grounded in `path` (its `source_docs` include it), sorted."""
        return list(self._by_doc.get(path, []))

    def entity_bm25(self, query: str) -> dict[str, float]:
        """{entity id: BM25 score} for the entities the query touches (score > 0).
        Rare terms dominate, so common words ("the") barely move an entity — the
        stopword problem the fixture would otherwise hit is handled by IDF."""
        terms = tokenize(query)
        if not terms or self._avg_len == 0:
            return {}
        term_freqs = [Counter(toks) for toks in self._tokens]
        doc_count = len(self._ids)
        doc_freq = {t: sum(1 for tf in term_freqs if tf[t] > 0) for t in set(terms)}
        scores: dict[str, float] = {}
        for eid, tf, length in zip(self._ids, term_freqs, self._lengths):
            score = 0.0
            for term in terms:
                if tf[term] == 0:
                    continue
                idf = math.log((doc_count - doc_freq[term] + 0.5) / (doc_freq[term] + 0.5) + 1)
                score += idf * (tf[term] * (K1 + 1)) / (tf[term] + K1 * (1 - B + B * length / self._avg_len))
            if score > 0:
                scores[eid] = round(score, 6)
        return scores

    def neighbor_entities(self, center_doc: str, depth: int) -> tuple[list[dict], list[dict]]:
        """spec/40 brain_neighbors layer=entities: seed with the doc's entities
        (distance 0), walk relations undirected to `depth`, return entity nodes
        {id,name,description,distance,source_docs} and the induced edges {src,dst}."""
        distance: dict[str, int] = {eid: 0 for eid in self.entities_for_doc(center_doc)}
        frontier = list(distance)
        for hop in range(1, depth + 1):
            reached: list[str] = []
            for eid in frontier:
                for neighbor, _weight in self.adjacency.get(eid, []):
                    if neighbor not in distance:
                        distance[neighbor] = hop
                        reached.append(neighbor)
            frontier = reached
        nodes = [
            {
                "id": eid,
                "name": self.entities[eid]["name"],
                "description": self.entities[eid].get("description"),
                "distance": hops,
                "source_docs": list(self.entities[eid].get("source_docs", [])),
            }
            for eid, hops in sorted(distance.items(), key=lambda kv: (kv[1], kv[0]))
        ]
        edges = [
            {"src": rel["src"], "dst": rel["dst"]}
            for rel in self.relations
            if rel["src"] in distance and rel["dst"] in distance
        ]
        return nodes, edges

    def entity_graph(self) -> dict:
        """The whole entity layer for /api/graph?layer=entities: nodes
        {id,name,type,description,degree,source_docs}, edges {src,dst,weight}
        (spec/40, spec/50). `source_docs` is sorted so the UI's entity panel can
        show an entity's provenance without N extra calls."""
        degree = {eid: len({n for n, _ in self.adjacency[eid]}) for eid in self._ids}
        nodes = [
            {
                "id": eid,
                "name": self.entities[eid]["name"],
                "type": self.entities[eid].get("type"),
                "description": self.entities[eid].get("description"),
                "degree": degree[eid],
                "source_docs": sorted(self.entities[eid].get("source_docs", [])),
            }
            for eid in self._ids
        ]
        edges = [
            {"src": rel["src"], "dst": rel["dst"], "weight": rel["weight"]}
            for rel in sorted(self.relations, key=lambda r: (r["src"], r["dst"]))
        ]
        return {"nodes": nodes, "edges": edges}


def load_kg(bp_dir: str | Path) -> KnowledgeGraph | None:
    """Read `.brainpick/t3/` into a graph, or None when the export is absent —
    T3 unavailable is a degradation, never an error (spec/40). An EMPTY export
    is valid and loads as an empty graph (a fully-written, untagged wiki has no
    sub-page concepts — consumers must tolerate zero entities). Dangling
    relations (an endpoint missing from entities.jsonl) are skipped, not fatal."""
    t3 = Path(bp_dir) / "t3"
    entities_path = t3 / "entities.jsonl"
    if not entities_path.is_file():
        return None
    entities: dict[str, dict] = {}
    for line in entities_path.read_text(encoding="utf-8").splitlines():
        if line:
            entity = json.loads(line)
            entities[entity["id"]] = entity

    relations: list[dict] = []
    relations_path = t3 / "relations.jsonl"
    if relations_path.is_file():
        for line in relations_path.read_text(encoding="utf-8").splitlines():
            if not line:
                continue
            rel = json.loads(line)
            if rel["src"] in entities and rel["dst"] in entities:
                relations.append(rel)

    meta: dict = {}
    meta_path = t3 / "kg-meta.json"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            meta = {}
    return KnowledgeGraph(entities, relations, meta)


def graph_search(kg: KnowledgeGraph, records: list[dict], query: str, limit: int = 8) -> list[dict]:
    """spec/40 mode=graph: match the query against entity name+description, expand
    one relation hop, and rank the source_docs of the matched-and-adjacent
    entities — "what connects to X" rather than "what says X". Returns spec/50
    hits with source "graph"."""
    entity_scores = kg.entity_bm25(query)
    if not entity_scores:
        return []
    by_path = {r["path"]: r for r in records if not r["reserved"]}
    doc_scores: dict[str, float] = {}
    for eid in sorted(entity_scores):  # deterministic summation order
        score = entity_scores[eid]
        for doc in kg.entities[eid].get("source_docs", []):
            doc_scores[doc] = doc_scores.get(doc, 0.0) + score
    for eid in sorted(entity_scores):
        score = entity_scores[eid]
        for neighbor, weight in kg.adjacency.get(eid, []):
            for doc in kg.entities[neighbor].get("source_docs", []):
                doc_scores[doc] = doc_scores.get(doc, 0.0) + score * weight * GRAPH_HOP_DECAY

    hits: list[dict] = []
    for path in sorted(doc_scores, key=lambda p: (-doc_scores[p], p)):
        meta = by_path.get(path)
        if meta is None:
            continue  # an entity grounds a reserved/deleted doc — not a searchable hit
        hits.append({
            "description": meta["description"],
            "path": path,
            "score": round(doc_scores[path], 6),
            "snippet": None,
            "source": "graph",
            "title": meta["title"],
        })
        if len(hits) == limit:
            break
    return hits


def link_walk_search(link_graph: dict, records: list[dict], query: str, limit: int = 8) -> list[dict]:
    """The mode=graph degrade when T3 is absent (spec/40): keyword hits, then one
    hop over the T1 link graph, so the answer still walks *some* graph. Keyword
    hits keep their source; docs reached only by a link are tagged "graph"."""
    seeds = keyword_search(records, query, limit=limit)
    by_path = {r["path"]: r for r in records if not r["reserved"]}
    adjacency: dict[str, set[str]] = {}
    for edge in link_graph.get("edges", []):
        adjacency.setdefault(edge["source"], set()).add(edge["target"])
        adjacency.setdefault(edge["target"], set()).add(edge["source"])

    seen = {hit["path"] for hit in seeds}
    extra: list[dict] = []
    for hit in seeds:
        for neighbor in sorted(adjacency.get(hit["path"], ())):
            if neighbor in seen or neighbor not in by_path:
                continue
            seen.add(neighbor)
            meta = by_path[neighbor]
            extra.append({
                "description": meta["description"],
                "path": neighbor,
                "score": round(hit["score"] * LINK_WALK_DECAY, 6),
                "snippet": None,
                "source": "graph",
                "title": meta["title"],
            })
    return (seeds + extra)[:limit]
