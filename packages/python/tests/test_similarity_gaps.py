"""The similarity gap-detector (spec/45): T2 vectors joined against T1's link
graph to surface semantically-similar, unlinked document pairs."""
import json

import pytest

from brainpick.compile.similarity_gaps import (
    ALLOWLIST_FILE,
    compute_pairs,
    read_allowlist,
    similarity_gaps_gate,
    run_similarity_gaps_stage,
)
from brainpick.config import Config


def graph_with_edges(*pairs):
    edges = [{"source": a, "target": b, "kind": "link", "label": "x", "count": 1}
              for a, b in pairs]
    return {"edges": edges}


# -- gate ------------------------------------------------------------------------


def test_gate_off_by_config():
    config = Config()
    config.modules.similarity_gaps = "off"
    assert similarity_gaps_gate(config, "fresh") == (False, None)


@pytest.mark.parametrize("mode", ["auto", "on"])
def test_gate_rides_t2_freshness(mode):
    config = Config()
    config.modules.similarity_gaps = mode
    assert similarity_gaps_gate(config, "fresh") == (True, None)
    assert similarity_gaps_gate(config, "off") == (False, None)
    assert similarity_gaps_gate(config, "stale") == (False, None)


# -- compute_pairs (pure) ---------------------------------------------------------


def test_compute_pairs_excludes_already_linked():
    vectors = {"a.md": [1.0, 0.0], "b.md": [1.0, 0.0]}  # identical — cosine 1.0
    graph = graph_with_edges(("a.md", "b.md"))
    pairs = compute_pairs(vectors, graph, set(), threshold=0.5, max_pairs=50, dismissed=set())
    assert pairs == []  # linked, so excluded regardless of similarity


def test_compute_pairs_finds_unlinked_similar_pair():
    vectors = {"a.md": [1.0, 0.0], "b.md": [0.9, 0.1], "c.md": [0.0, 1.0]}
    graph = graph_with_edges()  # nothing linked
    pairs = compute_pairs(vectors, graph, set(), threshold=0.9, max_pairs=50, dismissed=set())
    assert pairs == [{"a": "a.md", "b": "b.md", "score": pytest.approx(0.994, abs=1e-3),
                       "status": "open"}]


def test_compute_pairs_excludes_reserved_docs():
    vectors = {"a.md": [1.0, 0.0], "index.md": [1.0, 0.0]}
    pairs = compute_pairs(vectors, graph_with_edges(), {"index.md"}, threshold=0.5,
                          max_pairs=50, dismissed=set())
    assert pairs == []


def test_compute_pairs_sorts_by_score_desc_then_path_and_caps():
    vectors = {
        "a.md": [1.0, 0.0], "b.md": [0.99, 0.01],   # highest score
        "c.md": [1.0, 0.02], "d.md": [1.0, 0.05],   # lower score
    }
    pairs = compute_pairs(vectors, graph_with_edges(), set(), threshold=0.0,
                          max_pairs=1, dismissed=set())
    assert len(pairs) == 1
    assert pairs[0]["a"], pairs[0]["b"] == ("a.md", "b.md")


def test_compute_pairs_canonical_pair_order_is_lexicographic():
    vectors = {"z.md": [1.0, 0.0], "a.md": [1.0, 0.0]}
    pairs = compute_pairs(vectors, graph_with_edges(), set(), threshold=0.5,
                          max_pairs=50, dismissed=set())
    assert (pairs[0]["a"], pairs[0]["b"]) == ("a.md", "z.md")


def test_compute_pairs_marks_dismissed():
    vectors = {"a.md": [1.0, 0.0], "b.md": [1.0, 0.0]}
    pairs = compute_pairs(vectors, graph_with_edges(), set(), threshold=0.5,
                          max_pairs=50, dismissed={("a.md", "b.md")})
    assert pairs[0]["status"] == "dismissed"


# -- allowlist ---------------------------------------------------------------------


def test_read_allowlist_absent_file_is_empty(tmp_path):
    assert read_allowlist(tmp_path) == set()


def test_read_allowlist_normalizes_pair_order(tmp_path):
    (tmp_path / ALLOWLIST_FILE).write_text(
        '[[dismissed]]\na = "z.md"\nb = "a.md"\nreason = "not related"\n', encoding="utf-8",
    )
    assert read_allowlist(tmp_path) == {("a.md", "z.md")}


def test_read_allowlist_malformed_toml_is_empty_not_raising(tmp_path):
    (tmp_path / ALLOWLIST_FILE).write_text("not [ valid toml", encoding="utf-8")
    assert read_allowlist(tmp_path) == set()


# -- the compile stage ---------------------------------------------------------------


def test_run_similarity_gaps_stage_writes_the_artifact(tmp_path):
    from brainpick.vectorstore import VectorStore

    bp = tmp_path / ".brainpick"
    store = VectorStore(bp / "t2" / "lancedb")
    store.replace_all([
        {"id": "a#0", "doc": "a.md", "ord": 0, "text": "t", "vector": [1.0, 0.0]},
        {"id": "b#0", "doc": "b.md", "ord": 0, "text": "t", "vector": [0.95, 0.05]},
    ], dim=2)
    records = [{"path": "a.md", "reserved": False}, {"path": "b.md", "reserved": False}]
    config = Config()

    result = run_similarity_gaps_stage(bp, tmp_path, graph_with_edges(), records, config)
    assert result["pairs"] == [{"a": "a.md", "b": "b.md", "score": 0.999, "status": "open"}]

    written = json.loads((bp / "t1" / "similarity-gaps.json").read_text(encoding="utf-8"))
    assert written["threshold"] == 0.75
    assert written["max_pairs"] == 50
