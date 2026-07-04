import json
import shutil
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
