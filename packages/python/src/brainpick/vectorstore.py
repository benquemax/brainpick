"""The LanceDB chunk store (spec/30, layout normative): t2/lancedb/chunks.lance.

Import-guarded — lancedb ships in the [vectors] extra, and every entry point
degrades with an instruction instead of an ImportError. The on-disk Lance
dataset is the cross-runtime interoperability point: either engine may
compile it, either may query it.
"""
from __future__ import annotations

from pathlib import Path

TABLE = "chunks"
_DELETE_BATCH = 500  # keep the SQL predicate bounded


class VectorStoreUnavailable(Exception):
    """lancedb is missing or the dataset is unreadable — message is an instruction."""


def lancedb_available() -> bool:
    try:
        import lancedb  # noqa: F401
    except ImportError:
        return False
    return True


def _require_lancedb():
    try:
        import lancedb
    except ImportError as error:
        raise VectorStoreUnavailable(
            "lancedb is not installed — pip install 'brainpick[vectors]' to enable T2"
        ) from error
    return lancedb


def _schema(dim: int):
    import pyarrow as pa

    return pa.schema([
        pa.field("id", pa.utf8()),
        pa.field("doc", pa.utf8()),
        pa.field("ord", pa.int32()),
        pa.field("text", pa.utf8()),
        pa.field("vector", pa.list_(pa.float32(), dim)),
    ])


def _in_predicate(ids: list[str]) -> str:
    quoted = ", ".join("'" + chunk_id.replace("'", "''") + "'" for chunk_id in ids)
    return f"id IN ({quoted})"


def _table_names(db) -> set[str]:
    listed = db.list_tables()
    # lancedb 0.34 returns a ListTablesResponse envelope; older versions a plain list
    return set(getattr(listed, "tables", listed))


class VectorStore:
    """Create/open the `chunks` table under <path> and keep it in sync."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _connect(self):
        lancedb = _require_lancedb()
        self.path.mkdir(parents=True, exist_ok=True)
        return lancedb.connect(str(self.path))

    def _open_table(self, db):
        if TABLE not in _table_names(db):
            return None
        return db.open_table(TABLE)

    # -- writing -----------------------------------------------------------------

    def replace_all(self, rows: list[dict], dim: int) -> None:
        """Drop and rebuild — the fingerprint changed, every vector is invalid."""
        db = self._connect()
        if TABLE in _table_names(db):
            db.drop_table(TABLE)
        table = db.create_table(TABLE, schema=_schema(dim))
        if rows:
            table.add(rows)

    def upsert(self, rows: list[dict], delete_ids: set[str], dim: int) -> None:
        """Incremental sync: delete vanished/changed ids, add the fresh rows."""
        db = self._connect()
        table = self._open_table(db)
        if table is None:
            table = db.create_table(TABLE, schema=_schema(dim))
        ordered = sorted(delete_ids)
        for start in range(0, len(ordered), _DELETE_BATCH):
            table.delete(_in_predicate(ordered[start:start + _DELETE_BATCH]))
        if rows:
            table.add(rows)

    # -- reading -----------------------------------------------------------------

    def existing_ids(self) -> set[str]:
        return set(self.existing_shas())

    def existing_shas(self) -> dict[str, str]:
        """{chunk id: sha256 of stored text} — what is ACTUALLY embedded.

        Incrementality diffs against the store, not against the previous
        chunks.jsonl: after a failed embed pass the jsonl is current while the
        vectors lag, and only the store knows which ones.
        """
        if not self.path.is_dir() or not lancedb_available():
            return {}
        table = self._open_table(self._connect())
        if table is None:
            return {}
        from brainpick.core.canonical import sha256_hex

        data = table.to_arrow()
        ids = data.column("id").to_pylist()
        texts = data.column("text").to_pylist()
        return {i: sha256_hex(t.encode("utf-8")) for i, t in zip(ids, texts)}

    def query_vectors(self, vector: list[float], k: int) -> list[dict]:
        """Cosine top-k chunk rows (with `_distance`), nearest first."""
        if not self.path.is_dir():
            return []
        table = self._open_table(self._connect())
        if table is None:
            return []
        return table.search(vector).distance_type("cosine").limit(k).to_list()
