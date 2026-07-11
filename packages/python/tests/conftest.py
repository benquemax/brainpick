import json
import os
import shutil
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC = REPO_ROOT / "spec"
FIXTURE_BUNDLES = SPEC / "fixtures" / "bundles"
EXPECTED = SPEC / "fixtures" / "expected"


@pytest.fixture
def kotiaurinko(tmp_path: Path) -> Path:
    """A disposable copy of the kotiaurinko fixture bundle."""
    dst = tmp_path / "kotiaurinko"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", dst)
    return dst


def stage_t3_export(root: Path, bundle: str = "kotiaurinko") -> None:
    """Stage the hand-authored T3 export into a compiled bundle and flip its
    manifest tier to fresh — no extractor runs (spec/40). The twin of the Node
    harness's stageT3Export; kept byte-identical so a mistake in one fails the
    other's conformance. Compile the bundle before calling this."""
    from brainpick.core.canonical import canonical_json

    bp = root / ".brainpick"
    shutil.copytree(EXPECTED / bundle / "t3", bp / "t3", dirs_exist_ok=True)
    manifest = json.loads((bp / "manifest.json").read_text(encoding="utf-8"))
    manifest["tiers"]["t3"] = "fresh"
    (bp / "manifest.json").write_text(canonical_json(manifest), encoding="utf-8")


def stage_fake_henxels(bin_dir: Path, message: str, exit_code: int = 1) -> Path:
    """A fake `henxels` on PATH that just prints `message` and exits
    `exit_code` — CI-2 (_plans/2026-07-10-phase1.5-release.md): a bare
    extensionless file with a unix shebang is invisible to `shutil.which` on
    win32 (its PATHEXT-aware search never matches a candidate that doesn't
    already end in one of PATHEXT's extensions — confirmed against CPython's
    own shutil.which source), so tests exercising the write-guard's
    `henxels_on_path()` lookup were silently skipping it on Windows rather
    than genuinely testing it — the write path LOOKED unguarded there, but
    the actual production `shutil.which("henxels")` call is already
    PATHEXT-correct (a real `uv tool install henxels` produces a proper
    `henxels.exe` launcher on Windows, which this DOES find). Returns
    `bin_dir` for the caller to prepend onto PATH with `os.pathsep`."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        fake = bin_dir / "henxels.bat"
        fake.write_text(f"@echo off\r\necho {message}\r\nexit /b {exit_code}\r\n")
    else:
        fake = bin_dir / "henxels"
        fake.write_text(f"#!/bin/sh\necho '{message}'\nexit {exit_code}\n")
        fake.chmod(0o755)
    return bin_dir


def prepend_path(env_path: str, bin_dir: Path) -> str:
    """`bin_dir` + the existing PATH, joined with the platform separator —
    CI-2: the existing call sites hardcoded `:`, invisible-broken on
    Windows (`;`) even once the fake executable itself was fixed."""
    return f"{bin_dir}{os.pathsep}{env_path}"
