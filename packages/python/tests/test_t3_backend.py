"""KGBackend tests (spec/40): the deterministic MockKGBackend — the seam that
proves a future extractor could drop in behind the same protocol, with no
real extractor shipping today (LightRAG, since removed — see ADR: the
KGBackend adapter)."""
from brainpick.compile.t3 import normalize_export
from brainpick.kgadapt.protocol import KGBackend, MockKGBackend


# -- MockKGBackend -------------------------------------------------------------------


def test_mock_backend_is_a_kgbackend():
    assert isinstance(MockKGBackend(), KGBackend)  # satisfies the runtime Protocol


def test_mock_backend_derives_doc_anchored_entities_and_counts_inserts():
    backend = MockKGBackend()
    backend.insert([{"id": "kuu.md#kuu~0", "doc": "kuu.md", "text": "Kuu circles Maa nightly."}])
    export = backend.export()
    names = {e["name"] for e in export["entities"]}
    assert "Kuu" in names and "Maa" in names  # the doc's anchor + a capitalized word
    assert backend.inserts == [["kuu.md#kuu~0"]]  # every batch recorded for count assertions
    (rel,) = export["relations"]
    assert (rel["src_name"], rel["dst_name"]) == ("Kuu", "Maa")


def test_mock_backend_stub_mode_returns_verbatim():
    stub = {"entities": [{"name": "X", "type": "t", "description": "d", "source_docs": []}],
            "relations": []}
    backend = MockKGBackend(stub=stub)
    backend.insert([{"id": "a#0", "doc": "a.md", "text": "ignored"}])
    assert backend.export() is stub  # stub wins; content is ignored
    assert backend.inserts == [["a#0"]]  # …but the call still counts


def test_mock_backend_reset_forgets_derivation():
    backend = MockKGBackend()
    backend.insert([{"id": "a#0", "doc": "aurinko.md", "text": "Aurinko shines."}])
    backend.reset()
    assert backend.export() == {"entities": [], "relations": []}


def test_normalize_export_is_backend_agnostic():
    """The exporter takes any backend's neutral shape — proven with a raw dict, no
    extractor at all (the seam that lets a future backend drop in)."""
    raw = {"entities": [{"name": "Sol", "type": "STAR", "description": "  the star  ",
                         "source_docs": ["a.md"]}],
           "relations": []}
    entities, relations = normalize_export(raw, {"a.md"})
    assert entities == [{"description": "the star", "id": "sol", "name": "Sol",
                         "source_docs": ["a.md"], "type": "star"}]
    assert relations == []
