"""The algorithmic T3 backend (spec/40 "The algorithmic backend"): the knowledge
graph DERIVED from what the files carry — ghosts and tags — never extracted.
The derivation is exact and normative, so these tests pin every field the spec
names: ids from target stems, names from first references, the description
templates, the 1 − 2^(−shared) weights, and the canonical export bytes."""
import json

import pytest

from brainpick.compile.pipeline import run_compile
from brainpick.config import load_config, resolve_graph_backend
from brainpick.kg import load_kg
from brainpick.kgadapt.algorithmic import AlgorithmicKGBackend, derive_algorithmic_export


def record(path, text="", tags=None, reserved=False):
    """A minimal docs.jsonl record — the derivation's only input shape."""
    return {
        "description": None, "path": path, "reserved": reserved, "sha256": "0" * 64,
        "tags": tags or [], "text": text, "timestamp": None, "title": path, "type": None,
    }


def manifest_of(root):
    return json.loads((root / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))


# -- ghost entities (spec/40: dead link targets become concepts) -----------------------


def test_ghost_entity_from_a_dead_link():
    records = [record("a.md", "See [Olematon shoal](olematon.md) for more.")]
    entities, relations = derive_algorithmic_export(records)
    assert entities == [{
        "description": "Referenced from 1 page(s) but not yet written.",
        "id": "olematon",                      # the TARGET's stem, normalized — not the name
        "name": "Olematon shoal",              # the link text of the first reference
        "source_docs": ["a.md"],
        "type": "ghost",
    }]
    assert relations == []


def test_ghost_name_is_first_reference_in_sorted_path_then_document_order():
    records = [
        # b.md sorts after a.md, so its link text loses even though it is written first here
        record("b.md", "[wrong name](ghost.md)"),
        record("a.md", "before [Second](ghost.md) comes [First](ghost.md)."),
    ]
    entities, _ = derive_algorithmic_export(records)
    assert [e["name"] for e in entities] == ["Second"]  # a.md first, document order within
    assert entities[0]["source_docs"] == ["a.md", "b.md"]
    assert entities[0]["description"] == "Referenced from 2 page(s) but not yet written."


def test_ghost_key_is_the_normalized_stem_so_spellings_converge():
    # the same missing page referenced by different relative spellings is ONE concept
    records = [
        record("a.md", "[Ghost](ghost.md)"),
        record("sub/b.md", "[Other name](../ghost.md) and [[Ghost]]"),
    ]
    entities, _ = derive_algorithmic_export(records)
    assert len(entities) == 1
    assert entities[0]["id"] == "ghost"
    assert entities[0]["source_docs"] == ["a.md", "sub/b.md"]


def test_ghost_from_a_wikilink_and_name_whitespace_collapses():
    records = [record("a.md", "An old [[puuttuva sivu|Puuttuva\n  Sivu]] reference.")]
    entities, _ = derive_algorithmic_export(records)
    assert entities[0]["id"] == "puuttuva-sivu"
    assert entities[0]["name"] == "Puuttuva Sivu"  # runs of whitespace collapse to one space
    assert entities[0]["type"] == "ghost"


def test_ghost_with_empty_link_text_falls_back_to_the_stem():
    records = [record("a.md", "[](olematon.md)")]
    entities, _ = derive_algorithmic_export(records)
    assert entities[0]["name"] == "olematon"
    assert entities[0]["id"] == "olematon"


def test_resolved_links_and_degenerate_targets_yield_no_ghosts():
    records = [
        record("a.md", "[B](b.md) resolves; [self](a.md) is a self-link; [x](///) is degenerate."),
        record("b.md", ""),
    ]
    entities, _ = derive_algorithmic_export(records)
    assert entities == []


def test_reserved_docs_reference_ghosts_too():
    # T1 counts ghosts from every doc, index.md included (graph.json ghosts) — the
    # derivation reuses exactly that view, so the counts agree.
    records = [record("index.md", "* [Tuleva](tuleva.md) — not yet written", reserved=True)]
    entities, _ = derive_algorithmic_export(records)
    assert entities[0]["id"] == "tuleva"
    assert entities[0]["source_docs"] == ["index.md"]


# -- tag entities ----------------------------------------------------------------------


def test_tag_entity_name_is_as_first_written():
    records = [
        record("a.md", "", tags=["Saari"]),
        record("b.md", "", tags=["saari"]),
    ]
    entities, _ = derive_algorithmic_export(records)
    assert entities == [{
        "description": "Tagged on 2 page(s).",
        "id": "saari",
        "name": "Saari",                       # a.md sorts first — its spelling wins
        "source_docs": ["a.md", "b.md"],
        "type": "tag",
    }]


def test_empty_and_degenerate_tags_are_skipped():
    records = [record("a.md", "", tags=["", "###", "koti"])]
    entities, _ = derive_algorithmic_export(records)
    assert [e["id"] for e in entities] == ["koti"]


def test_ghost_and_tag_id_collision_disambiguates_in_name_codepoint_order():
    # a ghost "kuu" and a tag "kuu" are distinct entities behind one slug; the
    # codepoint-first name keeps the base id, the other takes -2 (spec/40).
    records = [record("a.md", "[Kuu](kuu.md)", tags=["kuu"])]
    entities, _ = derive_algorithmic_export(records)
    assert [(e["id"], e["name"], e["type"]) for e in entities] == [
        ("kuu", "Kuu", "ghost"),      # "Kuu" < "kuu" by codepoint
        ("kuu-2", "kuu", "tag"),
    ]


# -- co-occurrence relations -------------------------------------------------------------


def test_cooccurrence_weight_is_one_minus_two_to_minus_shared():
    records = [
        record("a.md", "[Ghost](ghost.md)", tags=["koti"]),
        record("b.md", "[Ghost](ghost.md)", tags=["koti"]),
        record("c.md", "", tags=["koti", "yksin"]),
    ]
    _, relations = derive_algorithmic_export(records)
    assert relations == [
        {
            "description": "Co-mentioned in 2 page(s).",
            "dst": "koti",
            "keywords": [],
            "source_docs": ["a.md", "b.md"],
            "src": "ghost",                    # src < dst by id
            "weight": 0.75,                    # 1 − 2^(−2), exactly representable
        },
        {
            "description": "Co-mentioned in 1 page(s).",
            "dst": "yksin",
            "keywords": [],
            "source_docs": ["c.md"],
            "src": "koti",
            "weight": 0.5,                     # 1 − 2^(−1)
        },
    ]


def test_empty_bundle_derives_an_empty_export():
    entities, relations = derive_algorithmic_export([record("a.md", "no links"), record("b.md")])
    assert entities == [] and relations == []


def test_backend_wraps_the_derivation_in_the_normative_shape():
    backend = AlgorithmicKGBackend([record("a.md", "[G](g.md)")])
    assert backend.available() is True
    assert backend.normative_export is True
    backend.insert([])  # a no-op — the derivation reads records, not chunks
    raw = backend.export()
    assert [e["id"] for e in raw["entities"]] == ["g"]
    assert raw["relations"] == []


# -- config resolution (spec/80: [modules] graph) ---------------------------------------


@pytest.mark.parametrize("toml, expected", [
    ("", "algorithmic"),                                                    # the default
    ('[modules]\ngraph = "algorithmic"\n', "algorithmic"),
    ('[modules]\ngraph = "off"\n', "off"),
    ('[modules]\ngraph = "lightrag"\n', "lightrag"),
    ('[modules]\ngraph = "auto"\n', "algorithmic"),                         # no extraction model
    ('[modules]\ngraph = "auto"\n[models.extraction]\nkind = "mock"\n', "lightrag"),
    ('[modules]\ngraph = "on"\n[models.extraction]\nkind = "mock"\n', "lightrag"),  # legacy on ≈ auto
    ('[modules]\ngraph = "on"\n', "algorithmic"),
    ('[modules]\ngraph = "sparkling"\n', "algorithmic"),                    # unknown → forgiving default
])
def test_resolve_graph_backend(tmp_path, toml, expected):
    if toml:
        (tmp_path / "brainpick.toml").write_text(toml, encoding="utf-8")
    assert resolve_graph_backend(load_config(tmp_path)) == expected


# -- the compile stage (default: algorithmic, zero config) ------------------------------


EXPECTED_ENTITY_LINES = [
    '{"description":"Tagged on 1 page(s).","id":"koti","name":"koti","source_docs":["maa.md"],"type":"tag"}',
    '{"description":"Tagged on 1 page(s).","id":"kuu","name":"kuu","source_docs":["kuu.md"],"type":"tag"}',
    '{"description":"Tagged on 1 page(s).","id":"luettelo","name":"luettelo","source_docs":["planeetat.md"],'
    '"type":"tag"}',
    '{"description":"Tagged on 1 page(s).","id":"mysteeri","name":"mysteeri","source_docs":["yksinainen.md"],'
    '"type":"tag"}',
    '{"description":"Referenced from 1 page(s) but not yet written.","id":"olematon","name":"Olematon",'
    '"source_docs":["saaret/laguuni.md"],"type":"ghost"}',
    '{"description":"Tagged on 1 page(s).","id":"planeetta","name":"planeetta","source_docs":["maa.md"],'
    '"type":"tag"}',
    '{"description":"Tagged on 2 page(s).","id":"saari","name":"saari",'
    '"source_docs":["saaret/atolli.md","saaret/laguuni.md"],"type":"tag"}',
    '{"description":"Tagged on 1 page(s).","id":"tähti","name":"tähti","source_docs":["aurinko.md"],'
    '"type":"tag"}',
    '{"description":"Tagged on 1 page(s).","id":"vierailija","name":"vierailija","source_docs":["komeetta.md"],'
    '"type":"tag"}',
]

EXPECTED_RELATION_LINES = [
    '{"description":"Co-mentioned in 1 page(s).","dst":"planeetta","keywords":[],"source_docs":["maa.md"],'
    '"src":"koti","weight":0.5}',
    '{"description":"Co-mentioned in 1 page(s).","dst":"saari","keywords":[],'
    '"source_docs":["saaret/laguuni.md"],"src":"olematon","weight":0.5}',
]


def test_default_compile_derives_t3_with_no_config_at_all(kotiaurinko):
    result = run_compile(kotiaurinko)  # zero config — the algorithmic default needs nothing
    assert manifest_of(kotiaurinko)["tiers"] == {"t1": "fresh", "t2": "off", "t3": "fresh"}
    assert not any("extraction" in w or "graph" in w for w in result.warnings)

    t3 = kotiaurinko / ".brainpick" / "t3"
    entities_text = (t3 / "entities.jsonl").read_text(encoding="utf-8")
    assert entities_text == "\n".join(EXPECTED_ENTITY_LINES) + "\n"
    relations_text = (t3 / "relations.jsonl").read_text(encoding="utf-8")
    assert relations_text == "\n".join(EXPECTED_RELATION_LINES) + "\n"
    meta = json.loads((t3 / "kg-meta.json").read_text(encoding="utf-8"))
    assert meta == {
        "entities": 9,
        "extractor": {"kind": "algorithmic"},  # no model — nothing was called
        "relations": 2,
        "spec_version": "0.1",
    }


def test_algorithmic_recompile_is_a_byte_stable_noop(kotiaurinko):
    first = run_compile(kotiaurinko)
    before = {p: p.read_bytes() for p in (kotiaurinko / ".brainpick").rglob("*") if p.is_file()}
    second = run_compile(kotiaurinko)
    assert first.changed is True and second.changed is False
    assert second.seq == first.seq
    after = {p: p.read_bytes() for p in (kotiaurinko / ".brainpick").rglob("*") if p.is_file()}
    assert after == before


def test_tag_only_edit_rederives_the_graph(kotiaurinko):
    """A frontmatter-tags-only change moves no chunk (chunks hash body text), yet the
    derived graph must follow — the algorithmic stage rederives on every pass."""
    run_compile(kotiaurinko)
    maa = kotiaurinko / "maa.md"
    maa.write_text(maa.read_text(encoding="utf-8").replace("[planeetta, koti]", "[planeetta]"),
                   encoding="utf-8")
    run_compile(kotiaurinko)
    entities = (kotiaurinko / ".brainpick" / "t3" / "entities.jsonl").read_text(encoding="utf-8")
    assert '"id":"koti"' not in entities
    assert '"id":"planeetta"' in entities


def test_empty_derivation_is_a_valid_fresh_export(tmp_path):
    """A fully-written, untagged wiki has no sub-page concepts: the export files
    exist with zero entities and the tier is honestly fresh (spec/40)."""
    root = tmp_path / "pieni"
    root.mkdir()
    (root / "yksi.md").write_text("---\ntype: Concept\n---\n\n# Yksi\n\n[Kaksi](kaksi.md)\n",
                                  encoding="utf-8")
    (root / "kaksi.md").write_text("---\ntype: Concept\n---\n\n# Kaksi\n\n[Yksi](yksi.md)\n",
                                   encoding="utf-8")
    run_compile(root)
    assert manifest_of(root)["tiers"]["t3"] == "fresh"

    t3 = root / ".brainpick" / "t3"
    assert (t3 / "entities.jsonl").read_text(encoding="utf-8") == ""
    assert (t3 / "relations.jsonl").read_text(encoding="utf-8") == ""
    meta = json.loads((t3 / "kg-meta.json").read_text(encoding="utf-8"))
    assert meta == {"entities": 0, "extractor": {"kind": "algorithmic"},
                    "relations": 0, "spec_version": "0.1"}

    # the empty export still LOADS: an empty entity layer, never a 404 (spec/40)
    kg = load_kg(root / ".brainpick")
    assert kg is not None
    assert kg.entity_graph() == {"nodes": [], "edges": []}


def test_lightrag_without_extraction_config_instructs(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text('[modules]\ngraph = "lightrag"\n', encoding="utf-8")
    first = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "off"
    assert any("models.extraction" in w for w in first.warnings)
    second = run_compile(kotiaurinko)
    assert not any("models.extraction" in w for w in second.warnings)  # said once


def test_only_t3_rederives_from_the_compiled_substrate(kotiaurinko):
    run_compile(kotiaurinko)
    t3 = kotiaurinko / ".brainpick" / "t3"
    (t3 / "entities.jsonl").unlink()  # vanish out of band
    result = run_compile(kotiaurinko, only=("t3",))
    assert result.changed is True
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "fresh"
    assert (t3 / "entities.jsonl").read_text(encoding="utf-8").splitlines() == EXPECTED_ENTITY_LINES


def test_sample_derives_only_the_first_n_docs(kotiaurinko):
    result = run_compile(kotiaurinko, sample=2)
    # first two non-reserved docs in path order: aurinko.md, komeetta.md → their tags only
    entities = (kotiaurinko / ".brainpick" / "t3" / "entities.jsonl").read_text(encoding="utf-8")
    assert set(json.loads(line)["id"] for line in entities.splitlines()) == {"tähti", "vierailija"}
    assert result.t3_summary == {"docs": 2, "entities": 2, "relations": 0}


def test_switching_to_the_mock_extractor_takes_over_the_export(kotiaurinko):
    run_compile(kotiaurinko)  # algorithmic first
    (kotiaurinko / "brainpick.toml").write_text(
        '[modules]\ngraph = "auto"\n[models.extraction]\nkind = "mock"\n', encoding="utf-8",
    )
    run_compile(kotiaurinko)
    meta = json.loads((kotiaurinko / ".brainpick" / "t3" / "kg-meta.json").read_text(encoding="utf-8"))
    assert meta["extractor"] == {"kind": "mock", "model": "mock"}  # the state fingerprint flipped
