"""Bundle scanning: documents, tolerant metadata, resolved links (spec/20)."""
from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from fnmatch import fnmatch
from pathlib import Path

from brainpick.core.canonical import sha256_hex
from brainpick.core.frontmatter import split_frontmatter
from brainpick.core.links import RawLink, extract_links

ALWAYS_EXCLUDED_DIRS = {".brainpick", ".git", "_temp", "node_modules"}
RESERVED_NAMES = {"index.md", "log.md", "skilltree.md"}
SKILL_TYPES = {"skill", "playbook"}  # spec/85: a skill by type, wherever it lives
_H1 = re.compile(r"^# +(.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class ResolvedLink:
    kind: str
    target: str
    text: str


@dataclass(frozen=True)
class Ghost:
    target: str


@dataclass
class Document:
    path: str
    sha256: str
    size: int
    title: str
    type: str | None
    about: str | None
    description: str | None
    tags: list[str]
    timestamp: str | None
    reserved: bool
    body: str
    links: list[ResolvedLink] = field(default_factory=list)
    ghosts: list[Ghost] = field(default_factory=list)
    skill: bool = False                                   # spec/20 Skills and frontmatter edges
    depends_on: list[str] = field(default_factory=list)   # RESOLVED prerequisites, declared order
    tools: list[str] = field(default_factory=list)        # declared tool paths, as written


def is_skill(type_value) -> bool:
    """A doc is a skill by its `type` — `skill` or the older `playbook`, trimmed,
    case-insensitive — never by folder (spec/85)."""
    return type_value is not None and str(type_value).strip().lower() in SKILL_TYPES


def _normalize_list(value) -> list[str]:
    """depends_on / tools: absent -> [], scalar wraps, values coerce to strings."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    return [str(value)]


def _normalize_timestamp(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _normalize_tags(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def resolve_doc_target(source: str, target: str, file_set: set[str]) -> str | None:
    """A frontmatter doc target (depends_on): rooted from the bundle root first —
    `a/b`, `a/b.md`, `a/b/index.md` — then relative to the source's directory,
    as given, then with `.md` appended (spec/20)."""
    target = str(target or "").strip()
    if not target:
        return None
    base = target.lstrip("/")
    for cand in (base, base + ".md", posixpath.join(base, "index.md")):
        if cand in file_set:
            return cand
    if target.startswith("/"):
        return None
    joined = posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
    if joined.startswith(".."):
        return None
    for cand in (joined, joined + ".md"):
        if cand in file_set:
            return cand
    return None


def title_of(meta: dict, body: str, path: str) -> str:
    if meta.get("title") is not None:
        return str(meta["title"])
    m = _H1.search(body)
    if m:
        return m.group(1)
    stem = posixpath.basename(path).rsplit(".", 1)[0]
    return stem.replace("-", " ").replace("_", " ")


def _collect_files(root: Path, include: tuple[str, ...], exclude: tuple[str, ...]) -> list[str]:
    files: set[str] = set()
    for pattern in include:
        for p in root.glob(pattern):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            parts = rel.split("/")
            if any(part in ALWAYS_EXCLUDED_DIRS for part in parts[:-1]):
                continue
            if any(fnmatch(rel, ex) for ex in exclude):
                continue
            files.add(rel)
    return sorted(files)


def build_stem_maps(paths: list[str]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """(stems, case-insensitive stems) for wikilink resolution — shared by scan
    and the algorithmic T3 derivation, so both resolve identically (spec/40)."""
    stems: dict[str, list[str]] = {}
    stems_ci: dict[str, list[str]] = {}
    for p in paths:
        stem = posixpath.basename(p).rsplit(".", 1)[0]
        stems.setdefault(stem, []).append(p)
        stems_ci.setdefault(stem.lower(), []).append(p)
    return stems, stems_ci


def resolve_link(source: str, raw: RawLink, file_set: set[str],
                 stems: dict[str, list[str]], stems_ci: dict[str, list[str]]) -> str | None:
    if raw.kind == "wikilink":
        exact = stems.get(raw.target, [])
        if len(exact) == 1:
            return exact[0]
        ci = stems_ci.get(raw.target.lower(), [])
        if len(ci) == 1:
            return ci[0]
        return None

    target = raw.target
    if target.startswith("/"):
        base = target.lstrip("/")
        for cand in (base, base + ".md", posixpath.join(base, "index.md")):
            if cand in file_set:
                return cand
        return None

    joined = posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
    if joined.startswith(".."):
        return None
    for cand in (joined, joined + ".md"):
        if cand in file_set:
            return cand
    return None


def scan(root: str | Path, include: tuple[str, ...] = ("**/*.md",),
         exclude: tuple[str, ...] = ()) -> list[Document]:
    root = Path(root)
    paths = _collect_files(root, include, exclude)
    file_set = set(paths)
    stems, stems_ci = build_stem_maps(paths)

    docs: list[Document] = []
    for path in paths:
        raw_bytes = (root / path).read_bytes()
        meta, body = split_frontmatter(raw_bytes.decode("utf-8", errors="replace"))

        links: list[ResolvedLink] = []
        ghosts: list[Ghost] = []
        for raw in extract_links(body):
            resolved = resolve_link(path, raw, file_set, stems, stems_ci)
            if resolved == path:
                continue  # self-links are dropped
            if resolved is None:
                ghosts.append(Ghost(target=raw.target))
            else:
                links.append(ResolvedLink(kind=raw.kind, target=resolved, text=raw.text))

        reserved = posixpath.basename(path) in RESERVED_NAMES
        skill = is_skill(meta.get("type")) and not reserved
        depends_on: list[str] = []
        tools: list[str] = []
        if skill:
            for declared in _normalize_list(meta.get("depends_on")):
                resolved = resolve_doc_target(path, declared, file_set)
                if resolved == path:
                    continue  # self-dependencies are dropped, like self-links
                if resolved is None:
                    ghosts.append(Ghost(target=declared))
                elif resolved not in depends_on:
                    depends_on.append(resolved)
            tools = _normalize_list(meta.get("tools"))

        docs.append(Document(
            path=path,
            sha256=sha256_hex(raw_bytes),
            size=len(raw_bytes),
            title=title_of(meta, body, path),
            type=None if meta.get("type") is None else str(meta["type"]),
            about=None if meta.get("about") is None else str(meta["about"]),
            description=None if meta.get("description") is None else str(meta["description"]),
            tags=_normalize_tags(meta.get("tags")),
            timestamp=_normalize_timestamp(meta.get("timestamp")),
            reserved=reserved,
            body=body,
            links=links,
            ghosts=ghosts,
            skill=skill,
            depends_on=depends_on,
            tools=tools,
        ))
    return docs
