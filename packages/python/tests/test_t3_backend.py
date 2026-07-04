"""KGBackend tests (spec/40): the deterministic MockKGBackend, the LightRAG
adapter behind its import guard, and a REAL extraction smoke against stabilitee —
both the smoke and the LightRAG cases skip visibly when their prerequisites are
missing (extractor advisory, spec/40)."""
import json

import httpx
import pytest

from brainpick.compile.t3 import normalize_export, run_t3_stage
from brainpick.config import Config
from brainpick.kgadapt.lightrag_backend import LightRAGBackend, lightrag_available
from brainpick.kgadapt.protocol import KGBackend, MockKGBackend

STABILITEE = "http://stabilitee:4800/v1"
STABILITEE_MODEL = "Qwen/Qwen3.6-35B-A3B-heretic-NVFP4"


def _stabilitee_up() -> bool:
    try:
        return httpx.get(f"{STABILITEE}/models", timeout=3.0).status_code == 200
    except Exception:
        return False


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


# -- LightRAGBackend (import-guarded) ------------------------------------------------


@pytest.mark.skipif(not lightrag_available(), reason="LightRAG (brainpick[graph]) not installed")
def test_lightrag_backend_available_reflects_config(tmp_path):
    from brainpick.config import ExtractionConfig

    nothing = LightRAGBackend(tmp_path / "lr", ExtractionConfig())
    assert isinstance(nothing.available(), str)  # a one-line instruction, not True

    configured = LightRAGBackend(
        tmp_path / "lr",
        ExtractionConfig(kind="openai-compatible", endpoint=STABILITEE, model="q"),
    )
    assert configured.available() is True


@pytest.mark.skipif(not lightrag_available(), reason="LightRAG (brainpick[graph]) not installed")
def test_lightrag_backend_header_distillation(tmp_path):
    from brainpick.kgadapt.lightrag_backend import _distill_header

    chunk = {"id": "kuu.md#kuu~0", "doc": "kuu.md", "text": "Body.",
             "title": "Kuu", "type": "Concept", "tags": ["moon", "sky"]}
    assert _distill_header(chunk) == "Title: Kuu | Type: Concept | Tags: moon, sky\n\nBody."
    assert _distill_header({"text": "Just body."}) == "Just body."  # empty header collapses


# -- the real extraction smoke -------------------------------------------------------


@pytest.mark.integration  # opt-in: hits the live LLM (~2min); excluded from the fast gate
@pytest.mark.skipif(
    not (lightrag_available() and _stabilitee_up()),
    reason="stabilitee unreachable or LightRAG missing",
)
def test_t3_real_extraction(tmp_path):
    """Extract a 2-3 doc subset against the real model; assert the export parses
    and holds at least one entity. Content is advisory (a model writes it), so we
    assert structure, never specific entities (spec/40)."""
    from brainpick.compile.t1 import build_docs_records
    from brainpick.compile.t2 import build_chunks
    from brainpick.core.bundle import scan
    from conftest import FIXTURE_BUNDLES
    import shutil

    bundle = tmp_path / "kotiaurinko"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", bundle)
    records = build_docs_records(scan(bundle))
    chunks = build_chunks(records)

    config = Config()
    config.modules.graph = "auto"
    config.models.extraction.kind = "openai-compatible"
    config.models.extraction.endpoint = STABILITEE
    config.models.extraction.model = STABILITEE_MODEL

    bp = bundle / ".brainpick"
    result = run_t3_stage(bp, records, chunks, config, sample=3)
    assert result.status == "fresh", result.warning

    entities = [json.loads(line)
                for line in (bp / "t3" / "entities.jsonl").read_text(encoding="utf-8").splitlines()
                if line]
    assert len(entities) >= 1
    for entity in entities:  # the neutral layout holds for every line
        assert set(entity) == {"description", "id", "name", "source_docs", "type"}
    meta = json.loads((bp / "t3" / "kg-meta.json").read_text(encoding="utf-8"))
    assert meta["extractor"]["kind"] == "lightrag"
    assert meta["entities"] == len(entities)


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
