"""T3 knowledge-graph reader (spec/40): id normalization, tolerant export
loading, entity neighbors, mode=graph ranking, the entity graph. The reader is
tested against a hand-authored fixture — never an extractor (spec/40)."""
import json
import shutil

import pytest

from brainpick.kg import (
    disambiguate_ids,
    graph_search,
    link_walk_search,
    load_kg,
    normalize_entity_id,
)

from conftest import SPEC

T3_FIXTURE = SPEC / "fixtures" / "expected" / "kotiaurinko" / "t3"
DOCS_JSONL = SPEC / "fixtures" / "expected" / "kotiaurinko" / ".brainpick" / "t1" / "docs.jsonl"


def _stage(tmp_path):
    """A .brainpick dir with the fixture t3/ export staged under it."""
    bp = tmp_path / ".brainpick"
    shutil.copytree(T3_FIXTURE, bp / "t3")
    return bp


def _records():
    return [json.loads(line) for line in DOCS_JSONL.read_text(encoding="utf-8").splitlines() if line]


# -- id normalization (golden) -------------------------------------------------------

# name -> id, pinned. Unicode letters survive NFC+lowercase (Yksinäinen), runs of
# non-alphanumerics collapse to a single "-" and trim at the ends.
ID_GOLDEN = [
    ("Aurinko", "aurinko"),
    ("Kuu", "kuu"),
    ("Yksinäinen", "yksinäinen"),   # unicode: ä is preserved, only cased down
    ("Solar System!", "solar-system"),
    ("  --Trim/Me--  ", "trim-me"),
    ("Ålänningen", "ålänningen"),
    ("H₂O and CO₂", "h₂o-and-co₂"),  # subscripts are \p{N}, kept as alphanumerics
]


@pytest.mark.parametrize("name,expected", ID_GOLDEN, ids=[n for n, _ in ID_GOLDEN])
def test_normalize_entity_id_golden(name, expected):
    assert normalize_entity_id(name) == expected


def test_fixture_names_normalize_to_their_ids():
    """Every fixture entity's name normalizes to its stored id — pins that
    str.lower() lands where the export author expected (and where JS agrees)."""
    for line in (T3_FIXTURE / "entities.jsonl").read_text(encoding="utf-8").splitlines():
        entity = json.loads(line)
        assert normalize_entity_id(entity["name"]) == entity["id"]


def test_disambiguate_collisions_in_codepoint_order():
    # "SOL" < "Sol" < "sol" by codepoint (S=0x53 before s=0x73; O=0x4f before o=0x6f).
    assert disambiguate_ids(["Sol", "sol", "SOL"]) == {"SOL": "sol", "Sol": "sol-2", "sol": "sol-3"}
    # distinct slugs never collide
    assert disambiguate_ids(["Aurinko", "Kuu"]) == {"Aurinko": "aurinko", "Kuu": "kuu"}
    # a mixed batch: only the same-slug names get suffixes
    assert disambiguate_ids(["New York", "new.york", "Kuu"]) == {
        "New York": "new-york", "new.york": "new-york-2", "Kuu": "kuu",
    }


# -- reader tolerance ----------------------------------------------------------------


def test_load_kg_absent_export_is_unavailable(tmp_path):
    assert load_kg(tmp_path / ".brainpick") is None  # no t3/ at all → None, not an error


def test_load_kg_empty_entities_is_unavailable(tmp_path):
    bp = tmp_path / ".brainpick"
    (bp / "t3").mkdir(parents=True)
    (bp / "t3" / "entities.jsonl").write_text("", encoding="utf-8")
    assert load_kg(bp) is None


def test_load_kg_tolerates_missing_relations_and_meta(tmp_path):
    bp = tmp_path / ".brainpick"
    (bp / "t3").mkdir(parents=True)
    (bp / "t3" / "entities.jsonl").write_text(
        '{"id":"a","name":"A","description":"first","source_docs":["a.md"],"type":"x"}\n',
        encoding="utf-8",
    )
    kg = load_kg(bp)
    assert kg is not None
    assert kg.relations == []
    assert kg.meta == {}
    assert kg.entities_for_doc("a.md") == ["a"]


def test_load_kg_skips_dangling_relations(tmp_path):
    bp = tmp_path / ".brainpick"
    (bp / "t3").mkdir(parents=True)
    (bp / "t3" / "entities.jsonl").write_text(
        '{"id":"a","name":"A","description":"first","source_docs":["a.md"],"type":"x"}\n',
        encoding="utf-8",
    )
    (bp / "t3" / "relations.jsonl").write_text(
        '{"src":"a","dst":"ghost","keywords":[],"source_docs":["a.md"],"weight":0.5}\n',
        encoding="utf-8",
    )
    kg = load_kg(bp)
    assert kg.relations == []  # the dangling endpoint 'ghost' is skipped, not fatal


def test_load_kg_reads_meta(tmp_path):
    kg = load_kg(_stage(tmp_path))
    assert kg.meta["entities"] == 6
    assert kg.meta["relations"] == 5


# -- neighbors -----------------------------------------------------------------------


def test_entities_for_doc(tmp_path):
    kg = load_kg(_stage(tmp_path))
    assert kg.entities_for_doc("kuu.md") == ["kuu", "maa", "vuorovesi"]
    assert kg.entities_for_doc("komeetta.md") == ["aurinko", "komeetta"]
    assert kg.entities_for_doc("olematon.md") == []


def test_neighbor_entities_depth_widens(tmp_path):
    kg = load_kg(_stage(tmp_path))
    nodes1, edges1 = kg.neighbor_entities("kuu.md", 1)
    assert [(n["id"], n["distance"]) for n in nodes1] == [
        ("kuu", 0), ("maa", 0), ("vuorovesi", 0), ("planeetat", 1),
    ]
    # each node carries the source_docs that ground it (spec/40)
    assert next(n for n in nodes1 if n["id"] == "kuu")["source_docs"] == [
        "aurinko.md", "kuu.md", "maa.md",
    ]
    assert {"src": "kuu", "dst": "vuorovesi"} in edges1
    # depth 2 reaches aurinko (kuu -> maa -> planeetat -> aurinko is 2 hops from a seed)
    nodes2, _ = kg.neighbor_entities("kuu.md", 2)
    assert {n["id"] for n in nodes2} == {"kuu", "maa", "vuorovesi", "planeetat", "aurinko"}
    assert next(n for n in nodes2 if n["id"] == "aurinko")["distance"] == 2


def test_neighbor_entities_empty_for_doc_without_entities(tmp_path):
    kg = load_kg(_stage(tmp_path))
    nodes, edges = kg.neighbor_entities("olematon.md", 2)
    assert nodes == [] and edges == []


# -- mode=graph ranking --------------------------------------------------------------


def test_graph_search_orbits_the_star_excludes_the_moon(tmp_path):
    """'what orbits the star' surfaces the star and its orbiters via the entity
    graph — komeetta.md ranks HIGH though its prose barely says 'star', while
    kuu.md (the moon orbits the earth, not the star) ranks last and is excluded."""
    kg = load_kg(_stage(tmp_path))
    hits = graph_search(kg, _records(), "what orbits the star", limit=4)
    assert [h["path"] for h in hits] == ["planeetat.md", "aurinko.md", "komeetta.md", "maa.md"]
    assert all(h["source"] == "graph" for h in hits)
    assert "kuu.md" not in {h["path"] for h in hits}


def test_graph_search_expands_beyond_the_keyword_doc(tmp_path):
    """'vuorovesi' appears in NO document body (keyword finds nothing), yet the
    entity grounds kuu.md and one hop reaches the moon's docs — pure graph recall."""
    kg = load_kg(_stage(tmp_path))
    hits = graph_search(kg, _records(), "vuorovesi", limit=8)
    assert {h["path"] for h in hits} == {"kuu.md", "aurinko.md", "maa.md"}
    assert hits[0]["path"] == "kuu.md"  # the doc that directly grounds the tide entity


def test_graph_search_no_entity_match_returns_empty(tmp_path):
    kg = load_kg(_stage(tmp_path))
    assert graph_search(kg, _records(), "zzz nonsense token", limit=8) == []


def test_graph_search_respects_limit(tmp_path):
    kg = load_kg(_stage(tmp_path))
    assert len(graph_search(kg, _records(), "what orbits the star", limit=2)) == 2


# -- entity graph (for /api/graph?layer=entities) ------------------------------------


def test_entity_graph_nodes_and_edges(tmp_path):
    kg = load_kg(_stage(tmp_path))
    graph = kg.entity_graph()
    aurinko = next(n for n in graph["nodes"] if n["id"] == "aurinko")
    assert aurinko == {
        "id": "aurinko", "name": "Aurinko", "type": "star",
        "description": "The star at the center that everything orbits.", "degree": 2,
    }
    assert [n["id"] for n in graph["nodes"]] == [
        "aurinko", "komeetta", "kuu", "maa", "planeetat", "vuorovesi",
    ]
    assert {"src": "komeetta", "dst": "aurinko", "weight": 0.6} in graph["edges"]
    assert len(graph["edges"]) == 5


# -- graph-mode degrade (T3 absent): T1 link-walk over keyword ------------------------


def test_link_walk_search_expands_keyword_over_t1_links():
    records = [
        {"path": "a.md", "title": "A", "description": "alpha", "text": "alpha", "reserved": False},
        {"path": "b.md", "title": "B", "description": "beta", "text": "beta", "reserved": False},
    ]
    link_graph = {"edges": [{"source": "a.md", "target": "b.md", "kind": "link"}]}
    hits = link_walk_search(link_graph, records, "alpha", limit=8)
    paths = [h["path"] for h in hits]
    assert paths == ["a.md", "b.md"]  # a.md keyword-matched; b.md reached by one T1 hop
    assert hits[0]["source"] == "keyword" and hits[1]["source"] == "graph"
