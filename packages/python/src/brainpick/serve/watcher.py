"""Watch mode (spec/60): debounced recompiles, plus manifest-seq watching so
compiles by other processes (cron, the sibling engine) produce deltas too."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from watchfiles import awatch

from brainpick.compile.pipeline import CompileResult, run_compile
from brainpick.core.bundle import ALWAYS_EXCLUDED_DIRS
from brainpick.serve.state import ServeState

DEBOUNCE_MS = 250  # spec/60 wants >= 200 ms of coalescing
log = logging.getLogger("brainpick.serve")


def source_filter(root: str | Path):
    """Only .md files outside .brainpick/, .git/, _temp/, node_modules/ count as sources."""
    root = Path(root)

    def allow(_change, path: str) -> bool:
        try:
            rel = Path(path).relative_to(root)
        except ValueError:
            return False
        parts = rel.parts
        if any(part in ALWAYS_EXCLUDED_DIRS for part in parts[:-1]):
            return False
        return parts[-1].endswith(".md")

    return allow


def bundle_filter(root: str | Path):
    """Sources plus the manifest — the one .brainpick/ file worth watching (foreign compiles)."""
    allow_source = source_filter(root)
    manifest = str(Path(root) / ".brainpick" / "manifest.json")

    def allow(change, path: str) -> bool:
        return path == manifest or allow_source(change, path)

    return allow


def recompile_and_broadcast(state: ServeState) -> CompileResult:
    """The one recompile path: watcher batches, guarded writes, and tests all route here.

    Hash-gated no-ops broadcast nothing; a change brackets its delta with
    compile.status running/done (spec/60)."""
    try:
        result = run_compile(state.root, config=state.config)
    except Exception:
        state.broadcast_status("failed", state.seq)
        raise
    if result.changed:
        state.broadcast_status("running", result.seq)
        state.apply_compile_result(result)
        state.broadcast_status("done", result.seq)
    return result


async def watch_bundle(state: ServeState) -> None:
    """Runs for the server's lifetime; cancelled by the app lifespan on shutdown."""
    root = state.root
    manifest = str(root / ".brainpick" / "manifest.json")
    async for changes in awatch(root, watch_filter=bundle_filter(root), step=DEBOUNCE_MS):
        paths = {path for _, path in changes}
        try:
            if manifest in paths:
                state.rescan_from_manifest()
            if paths - {manifest}:
                await asyncio.to_thread(recompile_and_broadcast, state)
        except Exception:  # keep watching; the failure went out as compile.status
            log.exception("recompile after a change failed")
