"""LanceDB store (spec/30 layout): t2/lancedb/chunks.lance, upserts, cosine queries."""
import pytest

lancedb = pytest.importorskip("lancedb", reason="[vectors] extra not installed")

from brainpick.vectorstore import VectorStore, lancedb_available  # noqa: E402


def row(chunk_id: str, vector: list[float], doc: str = "a.md", ordinal: int = 0, text: str = "t"):
    return {"id": chunk_id, "doc": doc, "ord": ordinal, "text": text, "vector": vector}


def test_lancedb_available_reports_true_here():
    assert lancedb_available() is True


def test_round_trip_layout_and_cosine_query(tmp_path):
    store = VectorStore(tmp_path / "t2" / "lancedb")
    store.replace_all([
        row("a.md#x~0", [1.0, 0.0, 0.0, 0.0]),
        row("b.md#y~0", [0.0, 1.0, 0.0, 0.0], doc="b.md"),
        row("c.md#z~0", [0.7, 0.7, 0.0, 0.0], doc="c.md"),
    ], dim=4)
    assert (tmp_path / "t2" / "lancedb" / "chunks.lance").is_dir()  # the spec layout

    hits = store.query_vectors([1.0, 0.05, 0.0, 0.0], k=2)
    assert [h["id"] for h in hits] == ["a.md#x~0", "c.md#z~0"]
    assert {"id", "doc", "ord", "text"} <= set(hits[0])
    assert store.existing_ids() == {"a.md#x~0", "b.md#y~0", "c.md#z~0"}


def test_store_survives_reopen(tmp_path):
    path = tmp_path / "lancedb"
    VectorStore(path).replace_all([row("a.md#x~0", [1.0, 0.0])], dim=2)
    fresh = VectorStore(path)
    assert fresh.existing_ids() == {"a.md#x~0"}
    assert [h["id"] for h in fresh.query_vectors([1.0, 0.0], k=1)] == ["a.md#x~0"]


def test_upsert_deletes_gone_ids_and_replaces_changed(tmp_path):
    store = VectorStore(tmp_path / "lancedb")
    store.replace_all([
        row("keep~0", [1.0, 0.0]),
        row("change~0", [0.0, 1.0]),
        row("gone~0", [0.5, 0.5]),
    ], dim=2)
    store.upsert(
        rows=[row("change~0", [1.0, 1.0]), row("new~0", [0.0, 0.5])],
        delete_ids={"gone~0", "change~0"},
        dim=2,
    )
    assert store.existing_ids() == {"keep~0", "change~0", "new~0"}
    [best] = store.query_vectors([1.0, 1.0], k=1)
    assert best["id"] == "change~0"  # the new vector answers, not the old one


def test_replace_all_wipes_previous_vectors(tmp_path):
    store = VectorStore(tmp_path / "lancedb")
    store.replace_all([row("old~0", [1.0, 0.0])], dim=2)
    store.replace_all([row("new~0", [1.0, 0.0, 0.0])], dim=3)  # dim change: full rebuild
    assert store.existing_ids() == {"new~0"}


def test_query_on_missing_table_returns_empty(tmp_path):
    store = VectorStore(tmp_path / "nowhere")
    assert store.query_vectors([1.0, 0.0], k=3) == []
    assert store.existing_ids() == set()


def test_ids_with_quotes_delete_safely(tmp_path):
    store = VectorStore(tmp_path / "lancedb")
    tricky = "a.md#it's~0"
    store.replace_all([row(tricky, [1.0, 0.0]), row("b~0", [0.0, 1.0])], dim=2)
    store.upsert(rows=[], delete_ids={tricky}, dim=2)
    assert store.existing_ids() == {"b~0"}
