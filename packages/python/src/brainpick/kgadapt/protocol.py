"""The KGBackend seam (spec/40) and a deterministic mock.

A backend extracts an entity/relation graph from chunks and hands it back in a
*backend-neutral* shape — names, not ids; no canonical ordering; no id
normalization. All of that is the exporter's job (`brainpick.compile.t3`), so a
new extractor is a drop-in behind this Protocol and nothing downstream moves.

Neutral shapes (what `export()` returns):

    entity   = {"name", "type", "description", "source_docs"}
    relation = {"src_name", "dst_name", "description", "keywords",
                "weight", "source_docs"}

`insert(chunks)` takes chunk dicts `{"id", "doc", "text"}`. `available()` is a
liveness/instruction probe (True, or a one-line reason string) for doctor.
"""
from __future__ import annotations

import re
from typing import Protocol, runtime_checkable

# Titlecase letter runs (Xxxx…): the capitalized words the mock treats as
# entities. Unicode-aware so Finnish "Yksinäinen"/"Planeetat" survive; the
# ``[1:].islower()`` guard drops ALLCAPS acronyms and keeps it deterministic.
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)

# Sentence-initial function words are capitalized but name nothing — skipping
# them for the *second* entity keeps the mock graph about concepts, not grammar.
# The doc's anchor entity (its stem) is never subject to this.
_STOPWORDS = frozenset({
    "The", "A", "An", "It", "Its", "This", "That", "These", "Those", "He", "She",
    "They", "We", "You", "Here", "There", "Then", "Thus", "So", "But", "And", "Or",
    "Yet", "For", "Not", "No", "Nothing", "Every", "Each", "All", "Some", "Any",
    "Many", "Few", "Old", "New", "Year", "Years", "Held", "When", "Where", "While",
    "With", "Without", "From", "Into", "Onto", "Over", "Under", "Now", "Later",
    "Still", "Also", "As", "At", "By", "In", "On", "To", "Of", "Up",
})


@runtime_checkable
class KGBackend(Protocol):
    """The extractor seam. Implementations persist however they like; the
    exporter drives insert → export and owns normalization."""

    def insert(self, chunks: list[dict]) -> None:
        """Extract entities/relations from these chunks into the backend's store."""
        ...

    def export(self) -> dict:
        """The whole accumulated graph in the neutral shape:
        ``{"entities": [...], "relations": [...]}``."""
        ...

    def available(self) -> bool | str:
        """True when ready, else a one-line instruction naming what is missing."""
        ...


def _titlecase_words(text: str) -> list[str]:
    """Capitalized words (Aurinko, Planeetat) in first-seen order, deduplicated —
    the mock's stand-in for 'what a model would name'."""
    seen: dict[str, None] = {}
    for word in _WORD.findall(text):
        if len(word) >= 3 and word[:1].isupper() and word[1:].islower():
            seen.setdefault(word, None)
    return list(seen)


def _primary_entity(doc: str) -> str:
    """The doc's anchor entity: its stem, titlecased (``kuu.md`` → ``Kuu``)."""
    stem = doc.rsplit("/", 1)[-1]
    stem = stem[:-3] if stem.endswith(".md") else stem
    return stem[:1].upper() + stem[1:] if stem else stem


class MockKGBackend:
    """A deterministic, dependency-free extractor — the test hook behind
    ``[models.extraction] kind = "mock"`` (never something init records).

    Two modes:

    - **derive** (default): each chunk yields its doc's anchor entity plus at
      most one other capitalized word, with a co-occurrence relation between
      them. Deterministic over a fixed bundle, so ``compile --only t3`` with
      ``kind=mock`` produces a byte-stable export the conformance suite pins.
    - **stub**: constructed with a ready-made neutral export, returned verbatim
      from ``export()`` — lets the exporter's normalization tests feed exact
      names (collisions, dangling relations) without a model.

    Either way it records every ``insert`` batch so tests can assert
    incrementality by call/count.
    """

    def __init__(self, stub: dict | None = None):
        self._stub = stub
        self.inserts: list[list[str]] = []  # one entry per insert() — the chunk ids seen
        self._entities: dict[str, dict] = {}
        self._relations: dict[tuple[str, str], dict] = {}

    # -- the seam ----------------------------------------------------------------

    def available(self) -> bool | str:
        return True

    def reset(self) -> None:
        """Forget everything derived — the exporter calls this before a full rebuild."""
        self._entities.clear()
        self._relations.clear()

    def insert(self, chunks: list[dict]) -> None:
        self.inserts.append([chunk["id"] for chunk in chunks])
        if self._stub is not None:
            return  # a stub export ignores content; it still counts the call
        for chunk in chunks:
            self._absorb(chunk)

    def export(self) -> dict:
        if self._stub is not None:
            return self._stub
        entities = [
            {
                "name": name,
                "type": "concept",
                "description": entity["description"],
                "source_docs": sorted(entity["docs"]),
            }
            for name, entity in self._entities.items()
        ]
        relations = [
            {
                "src_name": src,
                "dst_name": dst,
                "description": rel["description"],
                "keywords": ["mentions"],
                "weight": 0.5,
                "source_docs": sorted(rel["docs"]),
            }
            for (src, dst), rel in self._relations.items()
        ]
        return {"entities": entities, "relations": relations}

    # -- derivation --------------------------------------------------------------

    def _absorb(self, chunk: dict) -> None:
        doc = chunk["doc"]
        primary = _primary_entity(doc)
        names = [primary] if primary else []
        for word in _titlecase_words(chunk.get("text", "")):
            if word != primary and word not in _STOPWORDS:
                names.append(word)
                break  # at most a second entity per chunk
        for name in names:
            slot = self._entities.setdefault(
                name, {"description": f"The concept {name}.", "docs": set()}
            )
            slot["docs"].add(doc)
        if len(names) == 2:
            src, dst = names
            rel = self._relations.setdefault(
                (src, dst), {"description": f"{src} appears alongside {dst}.", "docs": set()}
            )
            rel["docs"].add(doc)
