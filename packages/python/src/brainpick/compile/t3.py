"""T3: the knowledge-graph tier (spec/40) — the EXTRACTOR side.

The extractor is private and non-deterministic (an LLM writes it); the neutral
export is the product. This module drives a `KGBackend` over the current chunks
and NORMALIZES whatever it produced into the spec/40 layout:
`t3/{entities.jsonl,relations.jsonl,kg-meta.json}`. Names become ids
(`kg.normalize_entity_id` + `disambiguate_ids`), dangling relations drop,
everything sorts canonically. It never raises — a failure leaves `tiers.t3`
stale with an instruction, exactly like T2 (spec/00 degradation ladder).

Incremental by chunk (which stands in for doc path): only changed chunks are
re-extracted; a deleted chunk, a changed extractor fingerprint, or `--full`
forces a clean rebuild — so the export always matches a from-scratch run.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from brainpick import SPEC_VERSION
from brainpick.core.canonical import canonical_json, canonical_jsonl, sha256_hex
from brainpick.core.fs import write_if_changed
from brainpick.kg import disambiguate_ids, normalize_entity_id
from brainpick.kgadapt.protocol import MockKGBackend

MAX_DESC = 400            # cap a description to one sentence-ish (spec/40: "one sentence")
_STATE_FILE = ".extract-state.json"  # {fingerprint, chunks: {id: sha256}} under t3/
_WS = re.compile(r"\s+")
_KW_SPLIT = re.compile(r"<SEP>|[,;\n]")


@dataclass
class T3Result:
    status: str                       # "fresh" | "stale" | "off" — tiers.t3
    changed: bool                     # any of the three export files changed on disk
    warning: str | None = None
    summary: dict | None = None       # --sample preview counts, printed by the CLI
    delta: dict | None = None         # graph delta placeholder (T3 currently empty)


def _lightrag_importable() -> bool:
    from brainpick.kgadapt.lightrag_backend import lightrag_available

    return lightrag_available()


def t3_gate(config) -> tuple[bool, str | None]:
    """(enabled, instruction) per [modules] graph. `mock` is a test hook that
    never needs LightRAG; a real kind needs the [graph] extra importable. Off
    yields the one enabling instruction (said once, like T2)."""
    if config.modules.graph == "off":
        return False, None
    if not config.models.extraction.kind:
        return False, (
            "T3 graph off — no [models.extraction] in brainpick.toml; point it at a chat "
            "model (e.g. a local qwen) in brainpick.local.toml to extract the entity graph"
        )
    if config.models.extraction.kind == "mock":
        return True, None
    if not _lightrag_importable():
        return False, (
            "T3 graph off — the extractor is missing: pip install 'brainpick[graph]'"
        )
    return True, None


def _extractor_meta(config) -> dict:
    """The kg-meta `extractor` block AND the incrementality fingerprint source.
    `mock` names itself; every real kind is `lightrag` today (the reference)."""
    ex = config.models.extraction
    if ex.kind == "mock":
        return {"kind": "mock", "model": ex.model or "mock"}
    return {"kind": "lightrag", "model": ex.model or ""}


def make_kg_backend(bp: Path, config, embedding_record: dict | None, fresh: bool):
    """The [models.extraction] record → a backend. Injection point: tests
    monkeypatch this to a counting fake (mirrors `make_embedder` in T2)."""
    if config.models.extraction.kind == "mock":
        return MockKGBackend()
    from brainpick.kgadapt.lightrag_backend import LightRAGBackend

    return LightRAGBackend(
        bp / "t3" / "lightrag", config.models.extraction,
        embedding_record=embedding_record, fresh=fresh,
    )


# -- the compile stage ---------------------------------------------------------------


def run_t3_stage(
    bp: Path,
    records: list[dict],
    chunks: list[dict],
    config,
    full: bool = False,
    sample: int | None = None,
) -> T3Result:
    """Extract → normalize → write the neutral export under <bp>/t3. Never raises."""
    valid_docs = {r["path"] for r in records if not r["reserved"]}
    enriched = _enrich_chunks(chunks, records)
    if sample is not None:
        enriched = _sample_chunks(enriched, sample)
        full = True  # a preview reflects only the sampled docs — start clean

    meta = _extractor_meta(config)
    fingerprint = f"{meta['kind']}|{meta['model']}"
    t3 = bp / "t3"
    state = _read_json(t3 / _STATE_FILE) or {}
    prev_chunks = state.get("chunks", {})
    current = {c["id"]: c["sha256"] for c in enriched}

    removed = set(prev_chunks) - set(current)
    changed = [c for c in enriched if prev_chunks.get(c["id"]) != c["sha256"]]
    # A vanished export must never be reported "fresh" (spec/40 tier honesty): if
    # entities.jsonl is gone (deleted out of band) the state file alone would say
    # "nothing changed", so force a rebuild so tiers.t3 reflects reality — the graph
    # is re-extracted, or, if the extractor is now unreachable, degrades to "stale".
    export_present = (t3 / "entities.jsonl").is_file()
    full_rebuild = (
        full or state.get("fingerprint") != fingerprint or bool(removed) or not export_present
    )
    to_insert = enriched if full_rebuild else changed

    if not full_rebuild and not to_insert:
        return T3Result("fresh", changed=False)  # no chunk moved — leave the export be

    embedding_record = _read_json(bp / "t2" / "embedding.json")
    try:
        backend = make_kg_backend(bp, config, embedding_record, fresh=full_rebuild)
        backend.insert(to_insert)
        raw = backend.export()
        entities, relations = normalize_export(raw, valid_docs)
    except Exception as error:  # extraction never blocks the compile (spec/00)
        return T3Result("stale", changed=False, warning=(
            f"T3 extraction failed ({error}) — the entity graph is stale; "
            "check the [models.extraction] endpoint and recompile"
        ))

    changed_files = _write_export(t3, entities, relations, meta)
    _write_json(t3 / _STATE_FILE, {"fingerprint": fingerprint, "chunks": current})
    _maybe_embed_entities(bp, entities, embedding_record)

    summary = None
    if sample is not None:
        summary = {"docs": len({c["doc"] for c in enriched}),
                   "entities": len(entities), "relations": len(relations)}
    return T3Result("fresh", changed=changed_files, summary=summary)


def _enrich_chunks(chunks: list[dict], records: list[dict]) -> list[dict]:
    """Carry each chunk's doc identity (title/type/tags) alongside its text, so a
    backend can distill a header. `sha256` stands in for change detection."""
    by_path = {r["path"]: r for r in records}
    out: list[dict] = []
    for chunk in chunks:
        doc = chunk["doc"]
        record = by_path.get(doc, {})
        out.append({
            "id": chunk["id"],
            "doc": doc,
            "text": chunk["text"],
            "sha256": chunk.get("sha256") or sha256_hex(chunk["text"].encode("utf-8")),
            "title": record.get("title", ""),
            "type": record.get("type", ""),
            "tags": record.get("tags", []),
        })
    return out


def _sample_chunks(chunks: list[dict], n: int) -> list[dict]:
    """Only the first `n` docs' chunks (docs in sorted path order) — the preview set."""
    keep: list[str] = []
    for doc in sorted({c["doc"] for c in chunks}):
        keep.append(doc)
        if len(keep) >= n:
            break
    wanted = set(keep)
    return [c for c in chunks if c["doc"] in wanted]


# -- normalization (spec/40) ---------------------------------------------------------


def normalize_export(raw: dict, valid_docs: set[str]) -> tuple[list[dict], list[dict]]:
    """The backend-neutral graph → the normative export. Names become ids via the
    reader's own normalizer (so extract and query agree by construction); empty or
    degenerate entities drop; relations to unresolved endpoints drop; descriptions
    cap; source_docs restrict to real bundle paths; everything sorts canonically."""
    merged: dict[str, dict] = {}
    for entity in raw.get("entities", []):
        name = _clean_text(entity.get("name"))
        if not name or not normalize_entity_id(name):
            continue  # empty, or nothing survives slugging — degenerate
        slot = merged.setdefault(name, {"type": "", "description": "", "docs": set()})
        etype = _clean_type(entity.get("type"))
        if etype and not slot["type"]:
            slot["type"] = etype
        desc = _clean_desc(entity.get("description"))
        if len(desc) > len(slot["description"]):
            slot["description"] = desc
        slot["docs"].update(_valid(entity.get("source_docs"), valid_docs))

    idmap = disambiguate_ids(list(merged))
    entities = sorted(
        (
            {
                "description": slot["description"],
                "id": idmap[name],
                "name": name,
                "source_docs": sorted(slot["docs"]),
                "type": slot["type"] or "entity",
            }
            for name, slot in merged.items()
        ),
        key=lambda e: e["id"],
    )

    pairs: dict[tuple[str, str], dict] = {}
    for rel in raw.get("relations", []):
        src = idmap.get(_clean_text(rel.get("src_name")))
        dst = idmap.get(_clean_text(rel.get("dst_name")))
        if src is None or dst is None or src == dst:
            continue  # dangling (endpoint sanitized away) or a self-loop — drop
        key = (src, dst) if src < dst else (dst, src)
        weight = _clamp01(rel.get("weight"))
        desc = _clean_desc(rel.get("description"))
        keywords = _clean_keywords(rel.get("keywords"))
        docs = _valid(rel.get("source_docs"), valid_docs)
        if key in pairs:
            slot = pairs[key]  # one line per unordered pair — merge the rest in
            slot["keywords"].update(keywords)
            slot["docs"].update(docs)
            slot["weight"] = max(slot["weight"], weight)
            if len(desc) > len(slot["description"]):
                slot["description"] = desc
        else:
            pairs[key] = {"src": src, "dst": dst, "description": desc,
                          "keywords": set(keywords), "weight": weight, "docs": set(docs)}

    relations = sorted(
        (
            {
                "description": slot["description"],
                "dst": slot["dst"],
                "keywords": sorted(slot["keywords"]),
                "source_docs": sorted(slot["docs"]),
                "src": slot["src"],
                "weight": slot["weight"],
            }
            for slot in pairs.values()
        ),
        key=lambda r: (r["src"], r["dst"]),
    )
    return entities, relations


def _clean_text(value) -> str:
    return _WS.sub(" ", str(value or "")).strip()


def _clean_type(value) -> str:
    cleaned = _clean_text(value).lower()
    return "" if cleaned in ("", "unknown") else cleaned


def _clean_desc(value) -> str:
    cleaned = _clean_text(value)
    if len(cleaned) <= MAX_DESC:
        return cleaned
    return cleaned[: MAX_DESC - 1].rstrip() + "…"


def _clean_keywords(value) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        tokens = [str(v) for v in value]
    else:
        tokens = _KW_SPLIT.split(str(value or ""))
    out: list[str] = []
    for token in tokens:
        word = _clean_text(token).lower()
        if word:
            out.append(word)
    return out


def _clamp01(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 1.0  # a relation with no weight is still a relation (LightRAG default)
    return round(min(1.0, max(0.0, number)), 3)


def _valid(docs, valid_docs: set[str]) -> set[str]:
    return {d for d in (docs or []) if d in valid_docs}


# -- writing -------------------------------------------------------------------------


def _write_export(t3: Path, entities: list[dict], relations: list[dict], meta: dict) -> bool:
    kg_meta = {
        "entities": len(entities),
        "extractor": meta,
        "relations": len(relations),
        "spec_version": SPEC_VERSION,
    }
    e_changed = write_if_changed(t3 / "entities.jsonl", canonical_jsonl(entities))
    r_changed = write_if_changed(t3 / "relations.jsonl", canonical_jsonl(relations))
    m_changed = write_if_changed(t3 / "kg-meta.json", canonical_json(kg_meta))
    return e_changed or r_changed or m_changed


def _maybe_embed_entities(bp: Path, entities: list[dict], embedding_record: dict | None) -> None:
    """Advisory (spec/40): embed `name — description` into a LanceDB `entities`
    table when T2 recorded a backend. Best-effort — its absence is tolerated, so a
    failure (backend down, lancedb missing) never touches the export or the tier."""
    if not entities or not embedding_record or embedding_record.get("kind") in (None, "", "mock"):
        return
    try:
        from brainpick.vectorstore import lancedb_available

        if not lancedb_available():
            return
        import lancedb
        import pyarrow as pa

        from brainpick.embed import make_embedder

        record = embedding_record
        import os

        embedder = make_embedder(
            record["kind"], record.get("endpoint", ""), record.get("model", ""),
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        )
        texts = [f'{e["name"]} — {e["description"]}' for e in entities]
        vectors = embedder.embed(texts)
        dim = len(vectors[0]) if vectors else int(record.get("dim") or 0)
        rows = [
            {"id": e["id"], "name": e["name"], "vector": v}
            for e, v in zip(entities, vectors)
        ]
        path = bp / "t3" / "lancedb"
        path.mkdir(parents=True, exist_ok=True)
        db = lancedb.connect(str(path))
        schema = pa.schema([
            pa.field("id", pa.utf8()),
            pa.field("name", pa.utf8()),
            pa.field("vector", pa.list_(pa.float32(), dim)),
        ])
        listed = db.list_tables()
        if "entities" in set(getattr(listed, "tables", listed)):
            db.drop_table("entities")
        table = db.create_table("entities", schema=schema)
        if rows:
            table.add(rows)
    except Exception:
        return  # advisory — never let entity vectors degrade the export


def _read_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, sort_keys=True), encoding="utf-8")
