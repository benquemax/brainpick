import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SPEC = REPO_ROOT / "spec"
FIXTURE_BUNDLES = SPEC / "fixtures" / "bundles"


@pytest.fixture
def kotiaurinko(tmp_path: Path) -> Path:
    """A disposable copy of the kotiaurinko fixture bundle."""
    dst = tmp_path / "kotiaurinko"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", dst)
    return dst
