"""T2 in the compile pipeline (spec/30): gating, incrementality, fingerprint,
failure degradation, and the --only lever. Uses the mock embedder via config."""
import hashlib
import json

import pytest

from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.embed import MockEmbedder

MOCK_CONFIG = '[models.embedding]\nkind = "mock"\n'


class CountingEmbedder:
    """Counts every batch it is asked to embed; answers with the normative mock."""

    def __init__(self):
        self.batches: list[list[str]] = []

    def embed(self, texts):
        self.batches.append(list(texts))
        return MockEmbedder().embed(texts)

    @property
    def embedded_texts(self):
        return [text for batch in self.batches for text in batch]


@pytest.fixture
def counting(monkeypatch):
    embedder = CountingEmbedder()
    monkeypatch.setattr("brainpick.compile.t2.make_embedder", lambda *a, **k: embedder)
    return embedder


def with_mock_config(root):
    (root / "brainpick.toml").write_text(MOCK_CONFIG, encoding="utf-8")
    return root


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def manifest_of(root):
    return read_json(root / ".brainpick" / "manifest.json")


# -- gating --------------------------------------------------------------------------


def test_t2_off_without_embedding_config_instructs_once(kotiaurinko):
    first = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "off"
    assert any("models.embedding" in w for w in first.warnings)
    second = run_compile(kotiaurinko)
    assert second.warnings == []  # the instruction lands once, not on every compile
    assert not (kotiaurinko / ".brainpick" / "t2").exists()


def test_t2_off_by_explicit_config_stays_quiet(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text(
        '[modules]\nvectors = "off"\n' + MOCK_CONFIG, encoding="utf-8",
    )
    result = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "off"
    assert result.warnings == []


def test_t2_off_when_lancedb_missing_names_the_extra(kotiaurinko, monkeypatch):
    monkeypatch.setattr("brainpick.compile.t2.lancedb_available", lambda: False)
    result = run_compile(with_mock_config(kotiaurinko))
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "off"
    assert any("brainpick[vectors]" in w for w in result.warnings)


# -- the happy compile ---------------------------------------------------------------


def test_mock_compile_writes_chunks_embedding_and_vectors(kotiaurinko, counting):
    run_compile(with_mock_config(kotiaurinko))
    bp = kotiaurinko / ".brainpick"
    assert manifest_of(kotiaurinko)["tiers"] == {"t1": "fresh", "t2": "fresh", "t3": "fresh"}

    lines = (bp / "t2" / "chunks.jsonl").read_text(encoding="utf-8").splitlines()
    chunks = [json.loads(line) for line in lines]
    assert [c["doc"] for c in chunks] == sorted(c["doc"] for c in chunks)
    assert "index.md" not in {c["doc"] for c in chunks}  # reserved docs never chunked
    assert "log.md" not in {c["doc"] for c in chunks}
    kuu = next(c for c in chunks if c["doc"] == "kuu.md")
    assert kuu["id"] == "kuu.md#kuu~0"
    assert kuu["heading_path"] == ["Kuu"]

    record = read_json(bp / "t2" / "embedding.json")
    expected_fp = hashlib.sha256(b"mock||mock|16").hexdigest()[:16]
    assert record == {
        "dim": 16, "endpoint": "", "fingerprint": expected_fp, "kind": "mock", "model": "mock",
    }
    assert (bp / "t2" / "lancedb" / "chunks.lance").is_dir()
    assert len(counting.embedded_texts) == len(chunks)


def test_recompile_is_noop_and_embeds_nothing(kotiaurinko, counting):
    run_compile(with_mock_config(kotiaurinko))
    counting.batches.clear()
    before = {p: p.read_bytes() for p in (kotiaurinko / ".brainpick").rglob("*") if p.is_file()}
    result = run_compile(kotiaurinko)
    assert result.changed is False
    assert counting.batches == []
    after = {p: p.read_bytes() for p in (kotiaurinko / ".brainpick").rglob("*") if p.is_file()}
    assert {p: b for p, b in after.items() if "lancedb" not in str(p)} == \
        {p: b for p, b in before.items() if "lancedb" not in str(p)}


def test_editing_one_doc_re_embeds_only_its_chunks(kotiaurinko, counting):
    first = run_compile(with_mock_config(kotiaurinko))
    counting.batches.clear()
    (kotiaurinko / "kuu.md").write_text(
        "---\ntype: Concept\n---\n\n# Kuu\n\nThe moon breathes new tides tonight.\n",
        encoding="utf-8",
    )
    result = run_compile(kotiaurinko)
    assert result.changed is True
    assert result.seq == first.seq + 1
    assert counting.embedded_texts == ["The moon breathes new tides tonight."]
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "fresh"


def test_deleting_a_doc_removes_its_chunks(kotiaurinko, counting):
    run_compile(with_mock_config(kotiaurinko))
    (kotiaurinko / "yksinainen.md").unlink()
    run_compile(kotiaurinko)
    chunks_text = (kotiaurinko / ".brainpick" / "t2" / "chunks.jsonl").read_text(encoding="utf-8")
    assert "yksinainen.md" not in chunks_text
    from brainpick.vectorstore import VectorStore

    ids = VectorStore(kotiaurinko / ".brainpick" / "t2" / "lancedb").existing_ids()
    assert not any(i.startswith("yksinainen.md#") for i in ids)


def test_fingerprint_change_re_embeds_everything(kotiaurinko, counting):
    run_compile(with_mock_config(kotiaurinko))
    total = len(counting.embedded_texts)
    counting.batches.clear()
    (kotiaurinko / "brainpick.toml").write_text(
        '[models.embedding]\nkind = "mock"\nmodel = "mock-v2"\n', encoding="utf-8",
    )
    result = run_compile(kotiaurinko)
    assert result.changed is True
    assert len(counting.embedded_texts) == total  # every chunk again
    record = read_json(kotiaurinko / ".brainpick" / "t2" / "embedding.json")
    assert record["model"] == "mock-v2"
    assert record["fingerprint"] == hashlib.sha256(b"mock||mock-v2|16").hexdigest()[:16]


# -- degradation ---------------------------------------------------------------------


def test_embed_failure_is_stale_never_a_compile_failure(kotiaurinko, monkeypatch):
    class Exploding:
        def embed(self, texts):
            raise RuntimeError("backend went away")

    monkeypatch.setattr("brainpick.compile.t2.make_embedder", lambda *a, **k: Exploding())
    result = run_compile(with_mock_config(kotiaurinko))
    manifest = manifest_of(kotiaurinko)
    assert manifest["tiers"]["t1"] == "fresh"
    assert manifest["tiers"]["t2"] == "stale"
    assert any("backend went away" in w for w in result.warnings)
    # chunks.jsonl is still written — "chunks changed but embedding hasn't run" (spec/30)
    assert (kotiaurinko / ".brainpick" / "t2" / "chunks.jsonl").is_file()
    assert (kotiaurinko / ".brainpick" / "t1" / "graph.json").is_file()


def test_recovery_after_failure_embeds_only_what_the_store_lacks(kotiaurinko, monkeypatch):
    """chunks.jsonl is current even after a failed pass — the store is the
    incrementality truth, so recovery re-embeds exactly the lagging chunks."""
    working = CountingEmbedder()
    monkeypatch.setattr("brainpick.compile.t2.make_embedder", lambda *a, **k: working)
    stale = run_compile(with_mock_config(kotiaurinko))

    class Exploding:
        def embed(self, texts):
            raise RuntimeError("down")

    monkeypatch.setattr("brainpick.compile.t2.make_embedder", lambda *a, **k: Exploding())
    (kotiaurinko / "kuu.md").write_text(
        "---\ntype: Concept\n---\n\n# Kuu\n\nRecovered tides.\n", encoding="utf-8",
    )
    failed = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "stale"
    assert failed.seq == stale.seq + 1  # chunks.jsonl moved with the edit

    monkeypatch.setattr("brainpick.compile.t2.make_embedder", lambda *a, **k: working)
    working.batches.clear()
    recovered = run_compile(kotiaurinko)
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "fresh"
    assert working.embedded_texts == ["Recovered tides."]  # only the lagging chunk
    assert recovered.seq == failed.seq  # tier transition alone never spends a seq


def test_check_fresh_stays_t1_only(kotiaurinko, monkeypatch):
    class Exploding:
        def embed(self, texts):
            raise RuntimeError("down")

    monkeypatch.setattr("brainpick.compile.t2.make_embedder", lambda *a, **k: Exploding())
    run_compile(with_mock_config(kotiaurinko))
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "stale"
    assert check_fresh(kotiaurinko).fresh is True  # T2 staleness never gates commits


# -- the --only lever ----------------------------------------------------------------


def test_only_t1_skips_t2_and_marks_it_stale(kotiaurinko, counting):
    run_compile(with_mock_config(kotiaurinko))
    counting.batches.clear()
    (kotiaurinko / "kuu.md").write_text("---\ntype: Concept\n---\n\n# Kuu\n\nNew.\n", encoding="utf-8")
    result = run_compile(kotiaurinko, only=("t1",))
    assert result.changed is True
    assert counting.batches == []
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "stale"


def test_only_t1_keeps_fresh_t2_fresh_when_nothing_changed(kotiaurinko, counting):
    run_compile(with_mock_config(kotiaurinko))
    counting.batches.clear()
    result = run_compile(kotiaurinko, only=("t1",))
    assert result.changed is False
    assert manifest_of(kotiaurinko)["tiers"]["t2"] == "fresh"


def test_only_t2_refreshes_vectors_without_touching_t1(kotiaurinko, counting):
    run_compile(kotiaurinko)  # T1-only compile, t2 off
    graph_before = (kotiaurinko / ".brainpick" / "t1" / "graph.json").read_bytes()
    seq_before = manifest_of(kotiaurinko)["seq"]
    with_mock_config(kotiaurinko)
    result = run_compile(kotiaurinko, only=("t2",))
    assert result.changed is True
    assert result.seq == seq_before + 1
    manifest = manifest_of(kotiaurinko)
    assert manifest["tiers"]["t2"] == "fresh"
    assert (kotiaurinko / ".brainpick" / "t1" / "graph.json").read_bytes() == graph_before
    assert (kotiaurinko / ".brainpick" / "t2" / "chunks.jsonl").is_file()
    assert counting.embedded_texts  # vectors actually built


def test_only_t2_before_any_compile_instructs(kotiaurinko):
    with_mock_config(kotiaurinko)
    result = run_compile(kotiaurinko, only=("t2",))
    assert result.changed is False
    assert any("brainpick compile" in w for w in result.warnings)


def test_full_recompile_re_embeds_everything_but_stays_byte_stable(kotiaurinko, counting):
    first = run_compile(with_mock_config(kotiaurinko))
    total = len(counting.embedded_texts)
    counting.batches.clear()
    result = run_compile(kotiaurinko, full=True)
    assert len(counting.embedded_texts) == total  # ignore the store, rebuild all
    assert result.seq == first.seq  # identical artifacts never bump seq
