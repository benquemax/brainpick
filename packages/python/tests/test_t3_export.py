"""T3 exporter normalization (spec/40): the backend-neutral graph → the normative
export. Names become ids, collisions disambiguate, dangling relations drop,
descriptions cap, weights clamp, everything sorts canonically. Driven through the
MockKGBackend stub so the seam is exercised, never an extractor."""
from brainpick.compile.t3 import MAX_DESC, normalize_export
from brainpick.kgadapt.protocol import MockKGBackend

DOCS = {"a.md", "b.md", "c.md"}


def _normalize(raw, valid_docs=DOCS):
    """Round-trip through the backend seam, exactly as run_t3_stage does."""
    return normalize_export(MockKGBackend(stub=raw).export(), valid_docs)


# -- names → ids ---------------------------------------------------------------------


def test_names_become_normalized_ids():
    raw = {
        "entities": [
            {"name": "Aurinko", "type": "star", "description": "The star.", "source_docs": ["a.md"]},
            {"name": "Yksinäinen", "type": "concept", "description": "A wanderer.",
             "source_docs": ["b.md"]},
        ],
        "relations": [],
    }
    entities, _ = _normalize(raw)
    assert [(e["name"], e["id"]) for e in entities] == [
        ("Aurinko", "aurinko"),
        ("Yksinäinen", "yksinäinen"),  # NFC + lowercase preserves the Unicode letter
    ]


def test_collision_gets_a_disambiguating_suffix():
    """Distinct names, same slug: the codepoint-first keeps the base, the rest -2,-3…"""
    raw = {
        "entities": [
            {"name": "Foo-Bar", "type": "x", "description": "second", "source_docs": ["a.md"]},
            {"name": "Foo Bar", "type": "x", "description": "first", "source_docs": ["a.md"]},
        ],
        "relations": [],
    }
    entities, _ = _normalize(raw)
    ids = {e["name"]: e["id"] for e in entities}
    assert ids == {"Foo Bar": "foo-bar", "Foo-Bar": "foo-bar-2"}  # space (0x20) sorts first


# -- sanitize ------------------------------------------------------------------------


def test_degenerate_and_empty_entities_drop():
    raw = {
        "entities": [
            {"name": "Real", "type": "t", "description": "kept", "source_docs": ["a.md"]},
            {"name": "", "type": "t", "description": "no name", "source_docs": ["a.md"]},
            {"name": "!!!", "type": "t", "description": "no alnum", "source_docs": ["a.md"]},
        ],
        "relations": [],
    }
    entities, _ = _normalize(raw)
    assert [e["id"] for e in entities] == ["real"]


def test_description_caps_and_type_defaults_and_source_docs_filter():
    raw = {
        "entities": [
            {"name": "Long", "type": "", "description": "x" * 900,
             "source_docs": ["a.md", "a.md", "ghost.md"]},
        ],
        "relations": [],
    }
    entities, _ = _normalize(raw)
    (entity,) = entities
    assert len(entity["description"]) == MAX_DESC and entity["description"].endswith("…")
    assert entity["type"] == "entity"  # empty type defaults, never blank
    assert entity["source_docs"] == ["a.md"]  # deduped and filtered to real bundle paths


def test_duplicate_names_merge_richest_description_and_union_docs():
    raw = {
        "entities": [
            {"name": "Kuu", "type": "moon", "description": "short", "source_docs": ["a.md"]},
            {"name": "Kuu", "type": "", "description": "a much longer description wins",
             "source_docs": ["b.md"]},
        ],
        "relations": [],
    }
    entities, _ = _normalize(raw)
    (entity,) = entities
    assert entity["description"] == "a much longer description wins"
    assert entity["type"] == "moon"  # first non-empty type sticks
    assert entity["source_docs"] == ["a.md", "b.md"]


# -- relations -----------------------------------------------------------------------


def _two_entities(extra_relations):
    return {
        "entities": [
            {"name": "Maa", "type": "planet", "description": "world", "source_docs": ["a.md"]},
            {"name": "Aurinko", "type": "star", "description": "star", "source_docs": ["a.md"]},
        ],
        "relations": extra_relations,
    }


def test_dangling_relation_drops_when_an_endpoint_is_missing():
    raw = _two_entities([
        {"src_name": "Maa", "dst_name": "Aurinko", "description": "orbits",
         "keywords": ["orbit"], "weight": 0.8, "source_docs": ["a.md"]},
        {"src_name": "Maa", "dst_name": "Ghost", "description": "to nowhere",
         "keywords": [], "weight": 0.5, "source_docs": ["a.md"]},
    ])
    _, relations = _normalize(raw)
    assert len(relations) == 1  # the Ghost endpoint never resolved — that line dropped
    assert {relations[0]["src"], relations[0]["dst"]} == {"aurinko", "maa"}  # names became ids


def test_self_loop_drops():
    raw = _two_entities([
        {"src_name": "Maa", "dst_name": "Maa", "description": "self", "weight": 0.5,
         "keywords": [], "source_docs": ["a.md"]},
    ])
    _, relations = _normalize(raw)
    assert relations == []


def test_weight_clamps_and_keywords_normalize():
    raw = _two_entities([
        {"src_name": "Maa", "dst_name": "Aurinko", "description": "d",
         "keywords": "Orbit,gravity,ORBIT", "weight": 2.0, "source_docs": ["a.md"]},
    ])
    _, relations = _normalize(raw)
    (rel,) = relations
    assert rel["weight"] == 1.0  # LightRAG sums to 2.0; the export clamps to [0,1]
    assert rel["keywords"] == ["gravity", "orbit"]  # lowercased, deduped, sorted


def test_unordered_pair_merges_both_directions():
    raw = _two_entities([
        {"src_name": "Maa", "dst_name": "Aurinko", "description": "short",
         "keywords": ["a"], "weight": 0.3, "source_docs": ["a.md"]},
        {"src_name": "Aurinko", "dst_name": "Maa", "description": "the longer one",
         "keywords": ["b"], "weight": 0.9, "source_docs": ["b.md"]},
    ])
    _, relations = _normalize(raw)
    (rel,) = relations  # one line per unordered pair
    assert rel["keywords"] == ["a", "b"]
    assert rel["weight"] == 0.9  # max of the merged
    assert rel["source_docs"] == ["a.md", "b.md"]
    assert rel["description"] == "the longer one"


def test_canonical_ordering():
    raw = {
        "entities": [
            {"name": "Zeta", "type": "t", "description": "z", "source_docs": ["a.md"]},
            {"name": "Alpha", "type": "t", "description": "a", "source_docs": ["a.md"]},
            {"name": "Mu", "type": "t", "description": "m", "source_docs": ["a.md"]},
        ],
        "relations": [
            {"src_name": "Zeta", "dst_name": "Alpha", "description": "", "keywords": [],
             "weight": 0.5, "source_docs": ["a.md"]},
            {"src_name": "Mu", "dst_name": "Alpha", "description": "", "keywords": [],
             "weight": 0.5, "source_docs": ["a.md"]},
        ],
    }
    entities, relations = _normalize(raw)
    assert [e["id"] for e in entities] == ["alpha", "mu", "zeta"]
    # lines sort by (src, dst); the extractor's chosen direction (→alpha) is preserved
    assert [(r["src"], r["dst"]) for r in relations] == [("mu", "alpha"), ("zeta", "alpha")]
