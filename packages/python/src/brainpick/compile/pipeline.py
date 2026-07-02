"""The compile pipeline (spec/10): scan → T1 → artifacts, hash-incremental,
byte-stable on no-ops, delta-emitting on change."""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from brainpick import SPEC_VERSION, __version__
from brainpick.compile.t1 import (
    apply_index_section,
    build_docs_records,
    build_graph,
    render_index_block,
)
from brainpick.core.bundle import scan
from brainpick.core.canonical import canonical_json, canonical_jsonl
from brainpick.deltas import diff_graphs

INDEX_FILE = "index.md"


@dataclass
class CompileResult:
    changed: bool
    seq: int
    stats: dict
    delta: dict | None


@dataclass
class Freshness:
    fresh: bool
    reason: str


def _prospective_index(root: Path, docs) -> tuple[str, str | None]:
    """(what index.md should contain, what it contains now)."""
    block = render_index_block(docs)
    disk = _read_or_none(root / INDEX_FILE)
    return apply_index_section(disk, block), disk


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".bp-tmp-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def _read_or_none(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.is_file() else None


def run_compile(root: str | Path, full: bool = False) -> CompileResult:
    root = Path(root)
    bp = root / ".brainpick"

    docs = scan(root)
    index_text, disk_index = _prospective_index(root, docs)
    index_changed = index_text != disk_index
    if index_changed:
        _atomic_write(root / INDEX_FILE, index_text.encode("utf-8"))
        docs = scan(root)  # the bundle now includes the index as written

    graph = build_graph(docs)
    graph_text = canonical_json(graph)
    docs_text = canonical_jsonl(build_docs_records(docs))

    old_manifest_text = _read_or_none(bp / "manifest.json")
    old_manifest = json.loads(old_manifest_text) if old_manifest_text else None
    old_graph_text = _read_or_none(bp / "t1" / "graph.json")

    unchanged = (
        old_manifest is not None
        and not index_changed
        and old_graph_text == graph_text
        and _read_or_none(bp / "t1" / "docs.jsonl") == docs_text
    )
    if unchanged and not full:
        return CompileResult(changed=False, seq=old_manifest["seq"], stats=graph["stats"], delta=None)

    _atomic_write(bp / "t1" / "graph.json", graph_text.encode("utf-8"))
    _atomic_write(bp / "t1" / "docs.jsonl", docs_text.encode("utf-8"))

    if old_manifest is None:
        seq = 1
    else:
        seq = old_manifest["seq"] + (0 if unchanged else 1)

    index_doc = next((d for d in docs if d.path == INDEX_FILE), None)
    manifest = {
        "bundle_root": ".",
        "compiled_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": {d.path: {"bytes": d.size, "sha256": d.sha256} for d in docs},
        "generator": {"impl": "python", "name": "brainpick", "version": __version__},
        "index_md": {
            "content_hash": index_doc.sha256 if index_doc else None,
            "managed": "section",
        },
        "seq": seq,
        "spec_version": SPEC_VERSION,
        "tiers": {"t1": "fresh", "t2": "off", "t3": "off"},
    }
    _atomic_write(bp / "manifest.json", canonical_json(manifest).encode("utf-8"))

    delta = None
    if old_graph_text is not None and not unchanged:
        delta = diff_graphs(json.loads(old_graph_text), graph)
        old_files = old_manifest["files"] if old_manifest else {}
        new_files = manifest["files"]
        delta["cause"] = {
            "paths": sorted(
                p for p in old_files.keys() | new_files.keys()
                if old_files.get(p, {}).get("sha256") != new_files.get(p, {}).get("sha256")
            ),
            "tier": "t1",
        }
        delta["seq"] = seq

    return CompileResult(changed=not unchanged, seq=seq, stats=graph["stats"], delta=delta)


def check_fresh(root: str | Path) -> Freshness:
    root = Path(root)
    bp = root / ".brainpick"
    if not (bp / "manifest.json").is_file():
        return Freshness(False, "never compiled — run: brainpick compile")

    docs = scan(root)
    index_text, disk_index = _prospective_index(root, docs)
    if index_text != disk_index:
        return Freshness(False, "stale — run: brainpick compile")

    graph_text = canonical_json(build_graph(docs))
    docs_text = canonical_jsonl(build_docs_records(docs))
    if (
        _read_or_none(bp / "t1" / "graph.json") != graph_text
        or _read_or_none(bp / "t1" / "docs.jsonl") != docs_text
    ):
        return Freshness(False, "stale — run: brainpick compile")
    return Freshness(True, "fresh")
