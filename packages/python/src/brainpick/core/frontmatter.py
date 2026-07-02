"""Tolerant YAML frontmatter splitting (OKF: consumers tolerate almost anything)."""
from __future__ import annotations

import yaml


def split_frontmatter(text: str) -> tuple[dict, str]:
    """Return (frontmatter mapping, body). Never raises: absent, unterminated,
    unparseable, or non-mapping frontmatter yields {} — the body is preserved."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        return {}, text

    end = text.find("\n---\n", 3)
    if end == -1:
        if text.endswith("\n---"):
            raw, body = text[4:-4], ""
        else:
            return {}, text
    else:
        raw = text[4:end]
        body = text[end + 5 :]

    try:
        meta = yaml.safe_load(raw)
    except yaml.YAMLError:
        return {}, body
    if not isinstance(meta, dict):
        return {}, body
    return meta, body
