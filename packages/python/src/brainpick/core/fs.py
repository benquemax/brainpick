"""Atomic file writes — temp + rename, so readers never see a torn artifact."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def atomic_write(path: Path, data: bytes) -> None:
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


def write_if_changed(path: Path, text: str) -> bool:
    """Write only when the bytes differ; returns whether anything changed on disk."""
    data = text.encode("utf-8")
    if path.is_file() and path.read_bytes() == data:
        return False
    atomic_write(path, data)
    return True
