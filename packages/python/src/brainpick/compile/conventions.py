"""Conventions (spec/85 *Conventions*, spec/20 *t1/conventions.json*): the
`type: convention` docs — standing rules — compiled into an artifact so the
overview and the AGENTS.md report can list them before anything else. The
engine indexes and never edits."""
from __future__ import annotations

from brainpick.core.bundle import Document, is_convention

__all__ = ["build_conventions", "is_convention"]


def build_conventions(docs: list[Document]) -> dict:
    """The t1/conventions.json payload: every convention, sorted by path."""
    return {"conventions": [
        {"description": doc.description, "path": doc.path, "title": doc.title}
        for doc in sorted(docs, key=lambda d: d.path) if doc.convention
    ]}
