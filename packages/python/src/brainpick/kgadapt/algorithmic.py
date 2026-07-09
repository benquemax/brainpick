"""The algorithmic T3 backend (spec/40 "The algorithmic backend") — the default.

The knowledge graph is DERIVED from what the files already carry, never
extracted: authors create connections proactively as links and tags, and this
module turns exactly those into entities. Dead link targets become **ghost**
entities (concepts referenced but not yet written), frontmatter tags become
**tag** entities, and entities sharing source docs get **co-occurrence**
relations. Pure computation over docs.jsonl records — no model, no endpoint,
no state — so the export is byte-reproducible and conformance-golden
(class `kg-algorithmic`), and it runs natively in both engines.

The derivation is normative and exact; every rule below has a spec sentence:

- ghost id = the dead TARGET's stem, normalized (not the link text);
  ghost name = the link text of the first reference, docs in sorted-path
  order and references in document order (whitespace runs collapse; an empty
  text falls back to the stem as written).
- tag id = the tag normalized; tag name = the tag as first written.
- descriptions are exact templates: "Referenced from N page(s) but not yet
  written." / "Tagged on N page(s)." / "Co-mentioned in N page(s)."
- relation weight = 1 − 2^(−shared): 0.5, 0.75, 0.875… — exactly
  representable floats, so both engines serialize identical bytes.
- id collisions (a ghost and a tag behind one slug) disambiguate -2, -3… in
  name codepoint order (type breaks a name tie), like spec/40 entity ids.

Like T1, references from EVERY doc count — reserved index/log included — so
the ghost entities agree with graph.json's ghost edges (the compiler's view
this derivation reuses).
"""
from __future__ import annotations

import re

from brainpick.core.bundle import build_stem_maps, resolve_link
from brainpick.core.links import extract_links
from brainpick.kg import normalize_entity_id

_WS = re.compile(r"\s+")

GHOST_DESCRIPTION = "Referenced from {n} page(s) but not yet written."
TAG_DESCRIPTION = "Tagged on {n} page(s)."
RELATION_DESCRIPTION = "Co-mentioned in {n} page(s)."


def _stem(target: str) -> str:
    """The target path's stem: basename, then drop the last dot-suffix (a leading
    dot is a hidden name, not a suffix). One rule, ported identically to Node."""
    base = target.rsplit("/", 1)[-1]
    dot = base.rfind(".")
    return base[:dot] if dot > 0 else base


def _clean_name(text: str) -> str:
    return _WS.sub(" ", str(text or "")).strip()


def derive_algorithmic_export(
    records: list[dict], contributors: set[str] | None = None,
) -> tuple[list[dict], list[dict]]:
    """records (docs.jsonl shape) → (entities, relations) in the final normative
    export shape — ids assigned, canonically sorted, ready to serialize.

    `contributors` restricts which docs CONTRIBUTE references and tags (the
    --sample preview); the existence set always covers every record, so a link
    to an unsampled-but-real page never fakes a ghost.
    """
    paths = sorted(r["path"] for r in records)
    file_set = set(paths)
    stems, stems_ci = build_stem_maps(paths)

    # kind keeps a ghost and a tag with the same slug apart until disambiguation
    slots: dict[tuple[str, str], dict] = {}  # (kind, preliminary id) -> {name, docs}
    for record in sorted(records, key=lambda r: r["path"]):
        if contributors is not None and record["path"] not in contributors:
            continue
        for raw in extract_links(record.get("text") or ""):
            if resolve_link(record["path"], raw, file_set, stems, stems_ci) is not None:
                continue  # the target exists (self-links resolve too) — not a ghost
            stem = _stem(raw.target)
            pid = normalize_entity_id(stem)
            if not pid:
                continue  # nothing survives slugging — degenerate
            slot = slots.setdefault(("ghost", pid), {"name": _clean_name(raw.text) or stem,
                                                     "docs": set()})
            slot["docs"].add(record["path"])
        for tag in record.get("tags") or []:
            pid = normalize_entity_id(tag)
            if not pid:
                continue
            slot = slots.setdefault(("tag", pid), {"name": str(tag), "docs": set()})
            slot["docs"].add(record["path"])

    # collisions (a ghost and a tag on one slug): base id to the codepoint-first
    # name, -2/-3… to the rest — name order, type as the tie-break (spec/40).
    by_pid: dict[str, list[tuple[str, str]]] = {}
    for kind, pid in slots:
        by_pid.setdefault(pid, []).append((kind, pid))
    ids: dict[tuple[str, str], str] = {}
    for pid, group in by_pid.items():
        group.sort(key=lambda key: (slots[key]["name"], key[0]))
        for index, key in enumerate(group):
            ids[key] = pid if index == 0 else f"{pid}-{index + 1}"

    entities = sorted(
        (
            {
                "description": (GHOST_DESCRIPTION if kind == "ghost" else TAG_DESCRIPTION)
                               .format(n=len(slot["docs"])),
                "id": ids[(kind, pid)],
                "name": slot["name"],
                "source_docs": sorted(slot["docs"]),
                "type": kind,
            }
            for (kind, pid), slot in slots.items()
        ),
        key=lambda e: e["id"],
    )

    # co-occurrence: one relation per unordered pair sharing >= 1 source doc.
    # Walking doc -> entities keeps it O(sum k²) over per-doc entity counts; the
    # per-doc lists inherit the entity sort, so (src, dst) is src < dst by id.
    by_doc: dict[str, list[str]] = {}
    for entity in entities:
        for doc in entity["source_docs"]:
            by_doc.setdefault(doc, []).append(entity["id"])
    pairs: dict[tuple[str, str], set[str]] = {}
    for doc, ids_in_doc in by_doc.items():
        for i, src in enumerate(ids_in_doc):
            for dst in ids_in_doc[i + 1:]:
                pairs.setdefault((src, dst), set()).add(doc)

    relations = [
        {
            "description": RELATION_DESCRIPTION.format(n=len(shared_docs)),
            "dst": dst,
            "keywords": [],
            "source_docs": sorted(shared_docs),
            "src": src,
            "weight": 1 - 2 ** (-len(shared_docs)),
        }
        for (src, dst), shared_docs in sorted(pairs.items())
    ]
    return entities, relations


class AlgorithmicKGBackend:
    """The KGBackend face of the derivation. Unlike an extractor its export is
    already NORMATIVE (ids assigned, canonical order) — `normative_export` tells
    the exporter to write it verbatim instead of re-normalizing names to ids
    (a ghost's id comes from the target stem, never from its name)."""

    normative_export = True

    def __init__(self, records: list[dict], contributors: set[str] | None = None):
        self._records = records or []
        self._contributors = contributors

    def available(self) -> bool:
        return True  # pure derivation — nothing to install, nothing to reach

    def insert(self, chunks: list[dict]) -> None:
        pass  # the derivation reads records, not chunks

    def export(self) -> dict:
        entities, relations = derive_algorithmic_export(self._records, self._contributors)
        return {"entities": entities, "relations": relations}
