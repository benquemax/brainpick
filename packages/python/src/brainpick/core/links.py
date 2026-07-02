"""Link extraction from markdown bodies (spec/20: fenced and inline code excluded)."""
from __future__ import annotations

import re
from dataclasses import dataclass

_FENCE = re.compile(r"^```.*?^```[ \t]*$", re.MULTILINE | re.DOTALL)
_INLINE_CODE = re.compile(r"`[^`\n]*`")
_MD_LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)\)")
_WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


@dataclass(frozen=True)
class RawLink:
    kind: str  # "link" | "wikilink"
    target: str
    text: str


def extract_links(body: str) -> list[RawLink]:
    scrubbed = _INLINE_CODE.sub("", _FENCE.sub("", body))

    found: list[tuple[int, RawLink]] = []
    for m in _WIKILINK.finditer(scrubbed):
        target = m.group(1).strip()
        text = (m.group(2) or m.group(1)).strip()
        if target:
            found.append((m.start(), RawLink("wikilink", target, text)))
    for m in _MD_LINK.finditer(scrubbed):
        target = m.group(2).split("#", 1)[0]
        if not target or _SCHEME.match(target):
            continue
        found.append((m.start(), RawLink("link", target, m.group(1))))

    found.sort(key=lambda item: item[0])
    return [link for _, link in found]
