"""T3 in the compile pipeline (spec/40): gating, tiers, incrementality, failure
degradation, the --only lever, and --sample. A counting fake backend stands in
for the extractor so 'only changed docs re-extracted' is asserted by call count."""
import json

import pytest

from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.kgadapt.protocol import MockKGBackend

# kind=mock lights T3 without LightRAG (a test hook); graph=auto turns the tier on.
MOCK_T3 = '[models.extraction]\nkind = "mock"\n[modules]\ngraph = "auto"\n'


class CountingBackend:
    """Counts every insert batch; derives the graph with the deterministic mock."""

    def __init__(self):
        self._mock = MockKGBackend()
        self.batches: list[list[str]] = []

    def available(self):
        return True

    def reset(self):
        self._mock.reset()

    def insert(self, chunks):
        self.batches.append([c["id"] for c in chunks])
        self._mock.insert(chunks)

    def export(self):
        return self._mock.export()

    @property
    def inserted_ids(self):
        return [cid for batch in self.batches for cid in batch]


@pytest.fixture
def counting(monkeypatch):
    backend = CountingBackend()

    def factory(bp, config, embedding_record, fresh):
        if fresh:
            backend.reset()  # a fresh backend starts empty (full rebuild)
        return backend

    monkeypatch.setattr("brainpick.compile.t3.make_kg_backend", factory)
    return backend


def with_t3(root):
    (root / "brainpick.toml").write_text(MOCK_T3, encoding="utf-8")
    return root


def manifest_of(root):
    return json.loads((root / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))


def entities_of(root):
    text = (root / ".brainpick" / "t3" / "entities.jsonl").read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line]


# -- gating --------------------------------------------------------------------------


def test_t3_off_without_extraction_config_instructs_once(kotiaurinko):
    # graph = "auto" but no [models.extraction] → off with a one-time instruction
    # (the default graph = "off" is silent — a zero-config bundle never nags).
    (kotiaurinko / "brainpick.toml").write_text('[modules]\ngraph = "auto"\n', encoding="utf-8")
    first = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "off"
    assert any("models.extraction" in w for w in first.warnings)
    second = run_compile(kotiaurinko)
    assert not any("models.extraction" in w for w in second.warnings)  # said once
    assert not (kotiaurinko / ".brainpick" / "t3").exists()


def test_t3_default_off_is_silent(kotiaurinko):
    result = run_compile(kotiaurinko)  # zero config: graph defaults off
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "off"
    assert not any("extraction" in w or "graph" in w for w in result.warnings)


def test_t3_off_by_explicit_config_stays_quiet(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text(
        '[modules]\ngraph = "off"\n[models.extraction]\nkind = "mock"\n', encoding="utf-8",
    )
    result = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "off"
    assert not any("graph" in w or "extraction" in w for w in result.warnings)


def test_t3_off_when_lightrag_missing_names_the_extra(kotiaurinko, monkeypatch):
    monkeypatch.setattr("brainpick.compile.t3._lightrag_importable", lambda: False)
    (kotiaurinko / "brainpick.toml").write_text(
        '[modules]\ngraph = "auto"\n[models.extraction]\n'
        'kind = "openai-compatible"\nendpoint = "http://x:4800/v1"\nmodel = "q"\n',
        encoding="utf-8",
    )
    result = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "off"
    assert any("brainpick[graph]" in w for w in result.warnings)


# -- the happy compile ---------------------------------------------------------------


def test_mock_compile_writes_the_neutral_export(kotiaurinko, counting):
    run_compile(with_t3(kotiaurinko))
    bp = kotiaurinko / ".brainpick"
    assert manifest_of(kotiaurinko)["tiers"] == {"t1": "fresh", "t2": "off", "t3": "fresh"}

    entities = entities_of(kotiaurinko)
    assert {e["id"] for e in entities} >= {"aurinko", "kuu", "maa"}
    assert [e["id"] for e in entities] == sorted(e["id"] for e in entities)  # canonical order

    meta = json.loads((bp / "t3" / "kg-meta.json").read_text(encoding="utf-8"))
    assert meta["entities"] == len(entities)
    assert meta["extractor"] == {"kind": "mock", "model": "mock"}
    assert meta["spec_version"] == "0.1"
    # every chunk was fed on the first (full) pass
    assert counting.inserted_ids  # extraction actually ran


def test_recompile_is_noop_and_extracts_nothing(kotiaurinko, counting):
    run_compile(with_t3(kotiaurinko))
    counting.batches.clear()
    before = {p: p.read_bytes() for p in (kotiaurinko / ".brainpick").rglob("*") if p.is_file()}
    result = run_compile(kotiaurinko)
    assert result.changed is False
    assert counting.batches == []  # nothing changed — the extractor is not even built
    after = {p: p.read_bytes() for p in (kotiaurinko / ".brainpick").rglob("*") if p.is_file()}
    assert after == before  # byte-stable, seq untouched


def test_editing_one_doc_re_extracts_only_its_chunks(kotiaurinko, counting):
    first = run_compile(with_t3(kotiaurinko))
    counting.batches.clear()
    (kotiaurinko / "kuu.md").write_text(
        "---\ntype: Concept\n---\n\n# Kuu\n\nThe moon breathes new tides tonight.\n",
        encoding="utf-8",
    )
    result = run_compile(kotiaurinko)
    assert result.changed is True and result.seq == first.seq + 1
    assert counting.inserted_ids == ["kuu.md#kuu~0"]  # only the changed doc's chunk
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "fresh"


def test_deleting_a_doc_rebuilds_and_drops_its_entities(kotiaurinko):
    """Deletion forces a clean rebuild so the export matches a from-scratch run
    (uses the real MockKGBackend, freshly built each compile — no shared state)."""
    with_t3(kotiaurinko)
    run_compile(kotiaurinko)
    assert any(e["id"] == "komeetta" for e in entities_of(kotiaurinko))
    (kotiaurinko / "komeetta.md").unlink()
    run_compile(kotiaurinko)
    ids = {e["id"] for e in entities_of(kotiaurinko)}
    assert "komeetta" not in ids
    assert "komeetta.md" not in {d for e in entities_of(kotiaurinko) for d in e["source_docs"]}


# -- tier honesty (tiers.t3 reflects what is actually on disk) ------------------------


def test_graph_off_resets_a_fresh_tier_to_off(kotiaurinko):
    """Turning [modules] graph off after a fresh extraction resets tiers.t3 to 'off'
    (spec/40) — /api/status and the AGENTS.md report would otherwise misreport T3."""
    with_t3(kotiaurinko)
    run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "fresh"
    (kotiaurinko / "brainpick.toml").write_text(
        '[modules]\ngraph = "off"\n[models.extraction]\nkind = "mock"\n', encoding="utf-8",
    )
    run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "off"  # honestly reset, not lingering


def test_removed_export_never_lingers_as_fresh(kotiaurinko):
    """A T3 export deleted out of band must never leave tiers.t3 lying 'fresh'
    (spec/40 tier honesty). The incremental fast-path would otherwise see 'no chunk
    changed' from the surviving .extract-state.json and keep 'fresh' though
    entities.jsonl is gone; the compile forces a rebuild so the manifest stays
    consistent with what is on disk."""
    with_t3(kotiaurinko)
    run_compile(kotiaurinko)
    entities = kotiaurinko / ".brainpick" / "t3" / "entities.jsonl"
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "fresh" and entities.is_file()

    entities.unlink()  # the export vanishes; .extract-state.json lingers
    run_compile(kotiaurinko)
    tier = manifest_of(kotiaurinko)["tiers"]["t3"]
    present = entities.is_file() and bool(entities.read_text(encoding="utf-8").strip())
    assert (tier == "fresh") == present  # never 'fresh' without an export behind it
    assert tier == "fresh" and present  # the mock extractor is still on → rebuilt


# -- degradation ---------------------------------------------------------------------


def test_extraction_failure_is_stale_never_a_compile_failure(kotiaurinko, monkeypatch):
    class Exploding:
        def available(self):
            return True

        def insert(self, chunks):
            raise RuntimeError("extractor went away")

        def export(self):  # pragma: no cover - never reached
            return {"entities": [], "relations": []}

    monkeypatch.setattr("brainpick.compile.t3.make_kg_backend", lambda *a, **k: Exploding())
    result = run_compile(with_t3(kotiaurinko))
    manifest = manifest_of(kotiaurinko)
    assert manifest["tiers"]["t1"] == "fresh"
    assert manifest["tiers"]["t3"] == "stale"
    assert any("extractor went away" in w for w in result.warnings)
    assert (kotiaurinko / ".brainpick" / "t1" / "graph.json").is_file()  # T1 untouched


def test_check_fresh_stays_t1_only(kotiaurinko, monkeypatch):
    class Exploding:
        def available(self):
            return True

        def insert(self, chunks):
            raise RuntimeError("down")

        def export(self):  # pragma: no cover
            return {"entities": [], "relations": []}

    monkeypatch.setattr("brainpick.compile.t3.make_kg_backend", lambda *a, **k: Exploding())
    run_compile(with_t3(kotiaurinko))
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "stale"
    assert check_fresh(kotiaurinko).fresh is True  # T3 staleness never gates commits


# -- the --only lever ----------------------------------------------------------------


def test_only_t1_skips_t3_and_marks_it_stale(kotiaurinko, counting):
    run_compile(with_t3(kotiaurinko))
    counting.batches.clear()
    (kotiaurinko / "kuu.md").write_text("---\ntype: Concept\n---\n\n# Kuu\n\nNew.\n", encoding="utf-8")
    result = run_compile(kotiaurinko, only=("t1",))
    assert result.changed is True
    assert counting.batches == []  # T3 skipped
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "stale"


def test_only_t3_refreshes_graph_without_touching_t1(kotiaurinko, counting):
    run_compile(kotiaurinko)  # T1-only substrate, t3 off
    graph_before = (kotiaurinko / ".brainpick" / "t1" / "graph.json").read_bytes()
    seq_before = manifest_of(kotiaurinko)["seq"]
    with_t3(kotiaurinko)
    result = run_compile(kotiaurinko, only=("t3",))
    assert result.changed is True and result.seq == seq_before + 1
    assert manifest_of(kotiaurinko)["tiers"]["t3"] == "fresh"
    assert (kotiaurinko / ".brainpick" / "t1" / "graph.json").read_bytes() == graph_before
    assert counting.inserted_ids  # graph actually built


def test_only_t3_before_any_compile_instructs(kotiaurinko):
    with_t3(kotiaurinko)
    result = run_compile(kotiaurinko, only=("t3",))
    assert result.changed is False
    assert any("brainpick compile" in w for w in result.warnings)


# -- --sample ------------------------------------------------------------------------


def test_sample_extracts_only_the_first_n_docs(kotiaurinko, counting):
    result = run_compile(with_t3(kotiaurinko), sample=2)
    docs_inserted = {cid.split("#")[0] for cid in counting.inserted_ids}
    assert len(docs_inserted) == 2  # only the first two docs' chunks
    assert result.t3_summary["docs"] == 2
    assert result.t3_summary["entities"] >= 1
    # the preview still writes a real export you can inspect
    assert (kotiaurinko / ".brainpick" / "t3" / "entities.jsonl").is_file()


def test_full_rebuild_re_extracts_everything(kotiaurinko, counting):
    run_compile(with_t3(kotiaurinko))
    total = len(counting.inserted_ids)
    counting.batches.clear()
    run_compile(kotiaurinko, full=True)
    assert len(counting.inserted_ids) == total  # every chunk again on --full
