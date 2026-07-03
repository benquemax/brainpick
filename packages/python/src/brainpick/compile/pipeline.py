"""The compile pipeline (spec/10): scan → T1 → T2 → artifacts, hash-incremental,
byte-stable on no-ops, delta-emitting on change."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from brainpick import SPEC_VERSION, __version__
from brainpick.compile.t1 import (
    apply_index_section,
    build_docs_records,
    build_graph,
    render_index_block,
)
from brainpick.compile.t2 import run_t2_stage, t2_gate
from brainpick.config import Config, load_config
from brainpick.core.bundle import scan
from brainpick.core.canonical import canonical_json, canonical_jsonl
from brainpick.core.fs import atomic_write
from brainpick.deltas import diff_graphs

INDEX_FILE = "index.md"
_atomic_write = atomic_write  # the historical name; other modules import it from here


@dataclass
class CompileResult:
    changed: bool
    seq: int
    stats: dict
    delta: dict | None
    warnings: list[str] = field(default_factory=list)


@dataclass
class Freshness:
    fresh: bool
    reason: str


def _prospective_index(root: Path, docs) -> tuple[str, str | None]:
    """(what index.md should contain, what it contains now)."""
    block = render_index_block(docs)
    disk = _read_or_none(root / INDEX_FILE)
    return apply_index_section(disk, block), disk


def _read_or_none(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.is_file() else None


def _generator() -> dict:
    return {"impl": "python", "name": "brainpick", "version": __version__}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_compile(
    root: str | Path,
    full: bool = False,
    only: tuple[str, ...] | None = None,
    config: Config | None = None,
) -> CompileResult:
    root = Path(root)
    bp = root / ".brainpick"
    if config is None:
        config = load_config(root)
    wanted = set(only) if only else {"t1", "t2"}
    if wanted == {"t2"}:
        return _compile_t2_only(root, bp, config)

    warnings: list[str] = []
    docs = scan(root)
    index_text, disk_index = _prospective_index(root, docs)
    index_changed = index_text != disk_index
    if index_changed:
        _atomic_write(root / INDEX_FILE, index_text.encode("utf-8"))
        docs = scan(root)  # the bundle now includes the index as written

    graph = build_graph(docs)
    graph_text = canonical_json(graph)
    records = build_docs_records(docs)
    docs_text = canonical_jsonl(records)

    old_manifest_text = _read_or_none(bp / "manifest.json")
    old_manifest = json.loads(old_manifest_text) if old_manifest_text else None
    old_graph_text = _read_or_none(bp / "t1" / "graph.json")
    old_tiers = old_manifest.get("tiers", {}) if old_manifest else {}

    t1_changed = not (
        old_manifest is not None
        and not index_changed
        and old_graph_text == graph_text
        and _read_or_none(bp / "t1" / "docs.jsonl") == docs_text
    )

    # T2 (spec/30): gated by [modules] vectors; failures degrade the tier, never the compile.
    enabled, instruction = t2_gate(config)
    if "t2" not in wanted:
        t2_changed = False
        if not enabled:
            t2_status = "off"
        elif not t1_changed and old_tiers.get("t2") == "fresh":
            t2_status = "fresh"
        else:
            t2_status = "stale"  # --only t1 skipped T2 while its inputs moved
    elif enabled:
        outcome = run_t2_stage(bp, records, config.models.embedding, full=full)
        t2_status, t2_changed = outcome.status, outcome.changed
        if outcome.warning:
            warnings.append(outcome.warning)
    else:
        t2_status, t2_changed = "off", False
        if instruction and old_tiers.get("t2") != "off":
            warnings.append(instruction)  # said once: the next manifest records t2 = off

    tiers = {"t1": "fresh", "t2": t2_status, "t3": "off"}
    artifacts_changed = t1_changed or t2_changed
    unchanged = not artifacts_changed and old_manifest is not None and old_tiers == tiers
    if unchanged and not full:
        return CompileResult(False, old_manifest["seq"], graph["stats"], None, warnings)

    _atomic_write(bp / "t1" / "graph.json", graph_text.encode("utf-8"))
    _atomic_write(bp / "t1" / "docs.jsonl", docs_text.encode("utf-8"))

    if old_manifest is None:
        seq = 1
    else:  # tier-status-only transitions rewrite the manifest without spending a seq
        seq = old_manifest["seq"] + (1 if artifacts_changed else 0)

    index_doc = next((d for d in docs if d.path == INDEX_FILE), None)
    manifest = {
        "bundle_root": ".",
        "compiled_at": _now(),
        "files": {d.path: {"bytes": d.size, "sha256": d.sha256} for d in docs},
        "generator": _generator(),
        "index_md": {
            "content_hash": index_doc.sha256 if index_doc else None,
            "managed": "section",
        },
        "seq": seq,
        "spec_version": SPEC_VERSION,
        "tiers": tiers,
    }
    _atomic_write(bp / "manifest.json", canonical_json(manifest).encode("utf-8"))

    delta = None
    if old_graph_text is not None and artifacts_changed:
        delta = diff_graphs(json.loads(old_graph_text), graph)
        old_files = old_manifest["files"] if old_manifest else {}
        new_files = manifest["files"]
        delta["cause"] = {
            "paths": sorted(
                p for p in old_files.keys() | new_files.keys()
                if old_files.get(p, {}).get("sha256") != new_files.get(p, {}).get("sha256")
            ),
            "tier": "t1" if t1_changed else "t2",
        }
        delta["seq"] = seq

    return CompileResult(not unchanged, seq, graph["stats"], delta, warnings)


def _compile_t2_only(root: Path, bp: Path, config: Config) -> CompileResult:
    """`--only t2`: refresh vectors from the already-compiled docs substrate.

    Chunks derive from t1/docs.jsonl (spec/30), so T1 artifacts and the file
    map stay exactly as the last full compile left them."""
    old_manifest_text = _read_or_none(bp / "manifest.json")
    docs_text = _read_or_none(bp / "t1" / "docs.jsonl")
    graph_text = _read_or_none(bp / "t1" / "graph.json")
    if old_manifest_text is None or docs_text is None or graph_text is None:
        return CompileResult(False, 0, {}, None, ["nothing compiled yet — run: brainpick compile"])
    old_manifest = json.loads(old_manifest_text)
    stats = json.loads(graph_text).get("stats", {})
    records = [json.loads(line) for line in docs_text.splitlines() if line]

    warnings: list[str] = []
    enabled, instruction = t2_gate(config)
    if enabled:
        outcome = run_t2_stage(bp, records, config.models.embedding)
        t2_status, t2_changed = outcome.status, outcome.changed
        if outcome.warning:
            warnings.append(outcome.warning)
    else:
        t2_status, t2_changed = "off", False
        if instruction and old_manifest.get("tiers", {}).get("t2") != "off":
            warnings.append(instruction)

    tiers = dict(old_manifest.get("tiers", {}))
    tiers["t2"] = t2_status
    if not t2_changed and tiers == old_manifest.get("tiers"):
        return CompileResult(False, old_manifest["seq"], stats, None, warnings)

    manifest = dict(old_manifest)
    manifest["tiers"] = tiers
    manifest["seq"] = old_manifest["seq"] + (1 if t2_changed else 0)
    manifest["compiled_at"] = _now()
    manifest["generator"] = _generator()
    _atomic_write(bp / "manifest.json", canonical_json(manifest).encode("utf-8"))
    return CompileResult(True, manifest["seq"], stats, None, warnings)


def check_fresh(root: str | Path) -> Freshness:
    """The commit gate — deliberately T1-only: it must stay deterministic and
    model-free (spec/10). T2 staleness (vectors lagging the chunks) is reported
    by `status`/`doctor` instead, so a missing embedding backend can never
    block a commit."""
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
