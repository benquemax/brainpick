"""Similarity gaps in the compile pipeline (spec/45): gating, artifact
placement, and that it never blocks compile."""
import json

from brainpick.compile.pipeline import run_compile

MOCK_CONFIG = '[models.embedding]\nkind = "mock"\n'


def with_mock_config(root):
    (root / "brainpick.toml").write_text(MOCK_CONFIG, encoding="utf-8")
    return root


def test_similarity_gaps_artifact_appears_once_t2_is_fresh(kotiaurinko):
    run_compile(with_mock_config(kotiaurinko))
    artifact = kotiaurinko / ".brainpick" / "t1" / "similarity-gaps.json"
    assert artifact.is_file()
    data = json.loads(artifact.read_text(encoding="utf-8"))
    assert data["threshold"] == 0.75
    assert data["max_pairs"] == 50
    # aurinko.md/maa.md: the highest similarity in the bundle, no direct edge
    # between them (they connect only via kuu.md/planeetat.md) — the natural
    # gap this fixture was chosen to exercise (see spec/conformance/cases.yaml).
    assert any(p["a"] == "aurinko.md" and p["b"] == "maa.md" for p in data["pairs"])


def test_similarity_gaps_absent_when_t2_off(kotiaurinko):
    run_compile(kotiaurinko)  # no mock config — T2 stays off by default (no embedding backend)
    assert not (kotiaurinko / ".brainpick" / "t1" / "similarity-gaps.json").is_file()


def test_similarity_gaps_off_by_explicit_config(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text(
        MOCK_CONFIG + '[modules]\nsimilarity_gaps = "off"\n', encoding="utf-8",
    )
    run_compile(kotiaurinko)
    assert not (kotiaurinko / ".brainpick" / "t1" / "similarity-gaps.json").is_file()


def test_similarity_gaps_never_tracked_as_a_manifest_tier(kotiaurinko):
    run_compile(with_mock_config(kotiaurinko))
    manifest = json.loads((kotiaurinko / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))
    assert set(manifest["tiers"]) == {"t1", "t2", "t3"}  # advisory, like timeline.json


def test_similarity_gaps_survives_a_missing_lancedb_table(kotiaurinko, monkeypatch):
    """A stage failure degrades to "no artifact", never breaks compile —
    mirrors _write_timeline's own never-block posture (spec/90)."""
    def boom(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr("brainpick.compile.pipeline.run_similarity_gaps_stage", boom)
    result = run_compile(with_mock_config(kotiaurinko))
    assert result.stats  # compile still completed
    assert not (kotiaurinko / ".brainpick" / "t1" / "similarity-gaps.json").is_file()
