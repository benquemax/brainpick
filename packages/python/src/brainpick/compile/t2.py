"""T2: the vectors tier (spec/30) — deterministic chunking, embedding, LanceDB.

The chunker is normative: both engines must produce byte-identical
t2/chunks.jsonl. Everything here is char-based — no tokenizer dependency.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from brainpick.core.canonical import canonical_json, canonical_jsonl, sha256_hex
from brainpick.core.fs import write_if_changed
from brainpick.embed import make_embedder
from brainpick.vectorstore import VectorStore, lancedb_available

MAX_CHUNK = 3200   # chars, hard budget per chunk (overlap counts toward it)
OVERLAP = 320      # chars of the previous chunk prefixed onto the next

_HEADING = re.compile(r"^(#{1,3}) (.*)$")
_FENCE = re.compile(r"^(`{3,}|~{3,})")
_SLUG_RUNS = re.compile(r"[\W_]+", re.UNICODE)  # non-alphanumeric runs (spec/30: `_` too)


def slugify(title: str) -> str:
    """lowercase; every run of non-alphanumerics → `-`; trimmed of `-` (spec/30)."""
    return _SLUG_RUNS.sub("-", title.lower()).strip("-")


def _fence_close(opening: str):
    """A fence closes on the same char, at least as long, nothing else on the line."""
    return re.compile(rf"^{re.escape(opening[0])}{{{len(opening)},}}\s*$")


def _split_sections(text: str) -> list[tuple[list[str], list[str]]]:
    """[(heading_path, content lines)] — split at ATX headings 1–3 outside fences.

    The heading line itself is not part of the section's content: the titles
    travel in heading_path (metadata), the text stays prose.
    """
    levels: dict[int, str] = {}
    sections: list[tuple[list[str], list[str]]] = [([], [])]
    fence_close = None
    for line in text.split("\n"):
        if fence_close is not None:
            sections[-1][1].append(line)
            if fence_close.match(line):
                fence_close = None
            continue
        fence = _FENCE.match(line)
        if fence:
            fence_close = _fence_close(fence.group(1))
            sections[-1][1].append(line)
            continue
        heading = _HEADING.match(line)
        if heading:
            level = len(heading.group(1))
            levels = {lv: t for lv, t in levels.items() if lv < level}
            levels[level] = heading.group(2).strip()
            path = [levels[lv] for lv in sorted(levels)]
            sections.append((path, []))
            continue
        sections[-1][1].append(line)
    return sections


def _split_paragraphs(lines: list[str]) -> list[str]:
    """Blank-line separated paragraphs; blank lines inside fences do not split."""
    paragraphs: list[str] = []
    current: list[str] = []
    fence_close = None
    for line in lines:
        if fence_close is not None:
            current.append(line)
            if fence_close.match(line):
                fence_close = None
            continue
        fence = _FENCE.match(line)
        if fence:
            fence_close = _fence_close(fence.group(1))
            current.append(line)
            continue
        if line.strip() == "":
            if current:
                paragraphs.append("\n".join(current))
                current = []
            continue
        current.append(line)
    if current:
        paragraphs.append("\n".join(current))
    return paragraphs


def _pack(paragraphs: list[str]) -> list[str]:
    """Greedy packing to MAX_CHUNK; chunks after the first reserve OVERLAP chars
    for the incoming prefix; a paragraph over the budget is hard-split."""
    chunks: list[str] = []
    parts: list[str] = []

    def budget() -> int:
        return MAX_CHUNK if not chunks else MAX_CHUNK - OVERLAP

    for paragraph in paragraphs:
        if parts and len("\n\n".join([*parts, paragraph])) > budget():
            chunks.append("\n\n".join(parts))
            parts = []
        if not parts and len(paragraph) > budget():
            rest = paragraph
            while len(rest) > budget():
                cut = budget()  # 3200 for a section's first chunk, 2880 after
                chunks.append(rest[:cut])
                rest = rest[cut:]
            parts = [rest] if rest else []
        else:
            parts.append(paragraph)
    if parts:
        chunks.append("\n\n".join(parts))
    return chunks


def chunk_document(record: dict) -> list[dict]:
    """spec/30's normative chunker over one docs.jsonl record (never a reserved doc)."""
    doc = record["path"]
    result: list[dict] = []
    ord_counter = 0
    for heading_path, lines in _split_sections(record["text"]):
        base = _pack(_split_paragraphs(lines))
        emitted: list[str] = []
        for i, text in enumerate(base):
            emitted.append(text if i == 0 else emitted[-1][-OVERLAP:] + text)
        slug_path = "/".join(slugify(title) for title in heading_path)
        n = 0
        for text in emitted:
            if not text.strip():
                continue  # spec/30 step 4: empty or whitespace-only chunks are dropped
            result.append({
                "doc": doc,
                "heading_path": list(heading_path),
                "id": f"{doc}#{slug_path}~{n}",
                "ord": ord_counter,
                "sha256": sha256_hex(text.encode("utf-8")),
                "text": text,
            })
            n += 1
            ord_counter += 1
    return result


def build_chunks(records: list[dict]) -> list[dict]:
    """Every chunk of every non-reserved document, sorted by (doc, ord)."""
    chunks: list[dict] = []
    for record in sorted(records, key=lambda r: r["path"]):
        if record["reserved"]:
            continue
        chunks.extend(chunk_document(record))
    return chunks


# -- the compile stage ---------------------------------------------------------------


@dataclass
class T2Result:
    status: str            # "fresh" | "stale" — tiers.t2 for the manifest
    changed: bool          # chunks.jsonl or embedding.json bytes changed
    warning: str | None = None


def fingerprint(kind: str, endpoint: str, model: str, dim: int) -> str:
    """First 16 hex chars of sha256 over `kind|endpoint|model|dim` (spec/30)."""
    return sha256_hex(f"{kind}|{endpoint}|{model}|{dim}".encode("utf-8"))[:16]


def t2_gate(config) -> tuple[bool, str | None]:
    """(enabled, instruction) per [modules] vectors: auto lights up when an
    embedding backend is configured AND lancedb is importable; otherwise the
    instruction names exactly what is missing (spec/30 detection ladder, rung 6)."""
    if config.modules.vectors == "off":
        return False, None  # the user chose off — no nagging
    if not config.models.embedding.kind:
        return False, (
            "T2 vectors off — no [models.embedding] in brainpick.toml; "
            "`brainpick init` detects local backends (ollama pull nomic-embed-text)"
        )
    if not lancedb_available():
        return False, (
            "T2 vectors off — the vector store is missing: pip install 'brainpick[vectors]'"
        )
    return True, None


def _normalized_backend(embedding) -> tuple[str, str, str]:
    """Config → the (kind, endpoint, model) recorded in embedding.json.

    `openai` (what init records for the paid API) is an openai-compatible
    endpoint; embedding.json keeps the spec/30 enum."""
    kind = "openai-compatible" if embedding.kind == "openai" else embedding.kind
    model = embedding.model or ("mock" if kind == "mock" else "")
    return kind, embedding.endpoint, model


def run_t2_stage(bp: Path, records: list[dict], embedding, full: bool = False) -> T2Result:
    """Compile chunks + vectors under <bp>/t2; never raises (failures degrade)."""
    chunks = build_chunks(records)
    chunks_changed = write_if_changed(bp / "t2" / "chunks.jsonl", canonical_jsonl(chunks))
    try:
        embedding_changed = _sync_vectors(bp, chunks, embedding, full)
    except Exception as error:  # T2 failures never block T1 (spec/00 degradation ladder)
        return T2Result("stale", chunks_changed, warning=(
            f"T2 embedding failed ({error}) — semantic search degrades to keyword; "
            "fix the backend and recompile"
        ))
    return T2Result("fresh", chunks_changed or embedding_changed)


def _read_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _sync_vectors(bp: Path, chunks: list[dict], embedding, full: bool) -> bool:
    kind, endpoint, model = _normalized_backend(embedding)
    embedder = make_embedder(kind, endpoint, model, api_key=os.environ.get("OPENAI_API_KEY", ""))
    store = VectorStore(bp / "t2" / "lancedb")

    old = _read_json(bp / "t2" / "embedding.json")
    same_backend = (
        not full
        and old is not None
        and (old.get("kind"), old.get("endpoint"), old.get("model")) == (kind, endpoint, model)
    )

    if same_backend:
        embedded = store.existing_shas()
        new_ids = {chunk["id"] for chunk in chunks}
        to_embed = [c for c in chunks if embedded.get(c["id"]) != c["sha256"]]
        delete_ids = (set(embedded) - new_ids) | {c["id"] for c in to_embed if c["id"] in embedded}
    else:
        to_embed, delete_ids = chunks, set()

    vectors = embedder.embed([chunk["text"] for chunk in to_embed]) if to_embed else []
    if to_embed:
        dim = len(vectors[0])
    elif same_backend:
        dim = int(old["dim"])
    elif embedding.dim:
        dim = int(embedding.dim)
    else:
        dim = len(embedder.embed(["brainpick"])[0])  # discover once, even with no chunks

    if same_backend and dim != int(old["dim"]):
        # the backend answers with a new dimensionality — every old vector is invalid
        same_backend = False
        to_embed = chunks
        vectors = embedder.embed([chunk["text"] for chunk in chunks])

    rows = [
        {"id": c["id"], "doc": c["doc"], "ord": c["ord"], "text": c["text"], "vector": v}
        for c, v in zip(to_embed, vectors)
    ]
    if same_backend:
        if rows or delete_ids:
            store.upsert(rows, delete_ids, dim)
    else:
        store.replace_all(rows, dim)

    record = {
        "dim": dim,
        "endpoint": endpoint,
        "fingerprint": fingerprint(kind, endpoint, model, dim),
        "kind": kind,
        "model": model,
    }
    return write_if_changed(bp / "t2" / "embedding.json", canonical_json(record))
