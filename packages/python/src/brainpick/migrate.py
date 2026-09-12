"""`brainpick migrate --to N` — the one command that rewrites committed bytes
(spec/85 *Versioning and migration*).

A migration is mechanical: it moves and splits files, rewrites links and the
`[brain] format` stamp, never prose. It is deterministic (the conformance
class `migrate` pins the 1 → 2 rewrite byte for byte across engines), writes
by default — one command for an agent, git is the undo — and `--dry-run`
prints the same action list plus a unified diff, writing nothing. Every step
works on an in-memory tree (`path → text`, `None` = deleted) that is applied
to disk at the very end, so a failure half-way leaves the bundle untouched.
"""
from __future__ import annotations

import difflib
import os
import posixpath
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable

from brainpick.config import Config, resolve_bundle

LATEST_FORMAT = 2
ENV_TODAY = "BRAINPICK_TODAY"

_MONTH_FILE = re.compile(r"^(\d{4})-(\d{2})\.md$")
_DAY_HEADING = re.compile(r"^## +(\d{4}-\d{2}-\d{2}) *$")
_MONTH_TITLE = re.compile(r"^# +\d{4}-\d{2} *$")
_H3 = re.compile(r"^### ")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
# Rewrite only real links: fences and inline code are skipped by matching them first.
_TOKEN = re.compile(r"(?P<fence>^```.*?^```[ \t]*$)|(?P<code>`[^`\n]*`)|(?P<link>(?<!!)\[[^\]]*\]\([^)\s]+\))",
                    re.MULTILINE | re.DOTALL)
_LINK = re.compile(r"(?<!!)(\[[^\]]*\]\()([^)\s]+)(\))")
_BRAIN_SECTION = re.compile(r"^\[brain\][ \t]*(?:#.*)?$")
_ANY_SECTION = re.compile(r"^\[")
_FORMAT_LINE = re.compile(r"^([ \t]*format[ \t]*=[ \t]*)(\d+)(.*)$")

TODO_INDEX = """# Todo

The brain's own work queue: `open.md` is the live list, `archive/` holds
what was closed, one file per day.

- [Open](open.md)
"""

TODO_OPEN_HEAD = """---
type: todo
title: Open
description: What is still to be done — the brain's live work queue.
timestamp: {today}T00:00:00Z
---

# Open
"""


class MigrateError(Exception):
    """A refusal: not a brain, a downgrade, an unknown target."""


@dataclass
class MigrateReport:
    from_format: int
    to_format: int
    actions: list[str] = field(default_factory=list)
    diff: str = ""
    dry_run: bool = False


class _Tree:
    """The bundle (and the repo root beside it) as `path → text`; `None` marks a
    deletion. Paths are posix, relative to the repo root `P`."""

    def __init__(self, repo: Path, bundle_rel: str):
        self.repo = repo
        self.bundle_rel = bundle_rel  # "" when the bundle IS the repo root
        self.files: dict[str, str | None] = {}
        self.original: dict[str, str | None] = {}
        self.actions: list[str] = []

    # -- paths ----------------------------------------------------------------
    def b(self, rel: str) -> str:
        """Bundle-relative → repo-relative."""
        return posixpath.join(self.bundle_rel, rel) if self.bundle_rel else rel

    def _disk(self, rel: str) -> Path:
        return self.repo / rel

    # -- reads ----------------------------------------------------------------
    def read(self, rel: str) -> str | None:
        if rel in self.files:
            return self.files[rel]
        path = self._disk(rel)
        text = path.read_text(encoding="utf-8") if path.is_file() else None
        self.original[rel] = text
        return text

    def exists(self, rel: str) -> bool:
        return self.read(rel) is not None

    def list_md(self, bundle_sub: str = "") -> list[str]:
        """Every .md under the bundle (bundle-relative, sorted), skipping `.brainpick`
        and the other always-excluded folders, with in-memory changes applied."""
        base = self._disk(self.b(bundle_sub)) if bundle_sub else self._disk(self.bundle_rel or ".")
        found: set[str] = set()
        if base.is_dir():
            for path in base.rglob("*.md"):
                rel = path.relative_to(self.repo).as_posix()
                if any(part in _SKIP_DIRS for part in Path(rel).parts):
                    continue
                found.add(rel)
        for rel, text in self.files.items():
            if text is None:
                found.discard(rel)
            elif rel.endswith(".md"):
                found.add(rel)
        prefix = self.b(bundle_sub)
        prefix = prefix + "/" if prefix else ""
        return sorted(r for r in found if r.startswith(prefix) and self.read(r) is not None)

    # -- writes ---------------------------------------------------------------
    def write(self, rel: str, text: str) -> None:
        if rel not in self.original:
            self.read(rel)
        self.files[rel] = text

    def delete(self, rel: str) -> None:
        if rel not in self.original:
            self.read(rel)
        self.files[rel] = None

    # -- the end --------------------------------------------------------------
    def changed(self) -> list[str]:
        return sorted(rel for rel, text in self.files.items() if self.original.get(rel) != text)

    def diff(self) -> str:
        out: list[str] = []
        for rel in self.changed():
            old = (self.original.get(rel) or "").splitlines(keepends=True)
            new = (self.files[rel] or "").splitlines(keepends=True)
            out.extend(difflib.unified_diff(old, new, fromfile=rel, tofile=rel))
        return "".join(out)

    def apply(self) -> None:
        for rel in self.changed():
            path = self._disk(rel)
            text = self.files[rel]
            if text is None:
                if path.exists():
                    path.unlink()
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8", newline="\n")


_SKIP_DIRS = {".brainpick", ".git", "_temp", "node_modules"}


# -- step 1: months into days --------------------------------------------------------

def split_month(text: str, month: str) -> list[tuple[str, str]]:
    """Split a format-1 month file into `(day, body)` pairs in file order. A `###`
    heading inside a day becomes `##`; non-date `##` content stays with the day it
    followed; the month's own `# YYYY-MM` title (and blank lines around it) is
    dropped, any other preamble opens the first day. No day heading at all → one
    day, the month's first."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()  # the trailing newline; re-added per day
    preamble: list[str] = []
    days: list[tuple[str, list[str]]] = []
    for line in lines:
        m = _DAY_HEADING.match(line)
        if m:
            days.append((m.group(1), []))
            continue
        if _H3.match(line):
            line = line[1:]
        (days[-1][1] if days else preamble).append(line)
    preamble = [ln for ln in preamble if not _MONTH_TITLE.match(ln)]
    preamble = _trim(preamble)
    if not days:
        days.append((f"{month}-01", []))
    out: list[tuple[str, str]] = []
    for i, (day, body) in enumerate(days):
        body = _trim(body)
        if i == 0 and preamble:
            body = preamble + ([""] if body else []) + body
        out.append((day, "\n".join([f"# {day}", ""] + body) + "\n"))
    return out


def _trim(lines: list[str]) -> list[str]:
    start, end = 0, len(lines)
    while start < end and lines[start].strip() == "":
        start += 1
    while end > start and lines[end - 1].strip() == "":
        end -= 1
    return lines[start:end]


def _day_target(day: str, today: str) -> str:
    """Bundle-relative home of a day file (spec/85): today at the top, else archive/YYYY/MM/."""
    if day == today:
        return f"journals/{day}.md"
    return f"journals/archive/{day[:4]}/{day[5:7]}/{day}.md"


def _rewrite_links(text: str, rewrite: Callable[[str], str | None]) -> tuple[str, int]:
    """Apply `rewrite(target) → new target | None` to every markdown link outside
    code; returns the new text and how many links changed."""
    count = 0

    def on_token(m: re.Match) -> str:
        nonlocal count
        if m.group("link") is None:
            return m.group(0)
        lm = _LINK.match(m.group(0))
        assert lm is not None
        new = rewrite(lm.group(2))
        if new is None or new == lm.group(2):
            return m.group(0)
        count += 1
        return f"{lm.group(1)}{new}{lm.group(3)}"

    return _TOKEN.sub(on_token, text), count


def _is_local(target: str) -> bool:
    return bool(target) and not _SCHEME.match(target)


def _resolve(doc_rel: str, target: str) -> str:
    """A link target as a bundle-relative posix path (fragment stripped)."""
    path = target.split("#", 1)[0]
    if path.startswith("/"):
        return posixpath.normpath(path.lstrip("/"))
    return posixpath.normpath(posixpath.join(posixpath.dirname(doc_rel), path))


def _relative(target_rel: str, doc_rel: str) -> str:
    start = posixpath.dirname(doc_rel) or "."
    return posixpath.relpath(target_rel, start)


def _step_journals(tree: _Tree, today: str) -> dict[str, dict[str, str]]:
    """Split every month file (top and flat archive) into day files. Returns
    `month path → {day → new path}` (bundle-relative), the map step 2 consumes;
    `""` keys the month's earliest day."""
    months: list[tuple[str, str]] = []
    for folder in ("journals", "journals/archive"):
        base = tree.repo / tree.b(folder) if tree.bundle_rel else tree.repo / folder
        if not base.is_dir():
            continue
        for path in sorted(base.iterdir()):
            m = _MONTH_FILE.match(path.name)
            if m and path.is_file():
                months.append((f"{folder}/{path.name}", f"{m.group(1)}-{m.group(2)}"))
    months.sort()
    mapping: dict[str, dict[str, str]] = {}
    for month_rel, month in months:
        text = tree.read(tree.b(month_rel))
        if text is None:
            continue
        days = split_month(text, month)
        tree.actions.append(f"split {month_rel} → {len(days)} day file{'s' if len(days) != 1 else ''}")
        homes: dict[str, str] = {}
        for day, body in days:
            new_rel = _day_target(day, today)
            homes[day] = new_rel

            def re_root(target: str, _old=month_rel, _new=new_rel) -> str | None:
                if not _is_local(target) or target.startswith("/"):
                    return None
                path, _, frag = target.partition("#")
                if not path:
                    return None
                moved = _relative(_resolve(_old, path), _new)
                return moved + (f"#{frag}" if frag else "")

            body, _ = _rewrite_links(body, re_root)
            tree.write(tree.b(new_rel), body)
            tree.actions.append(f"move {month_rel}#{day} → {new_rel}")
        tree.delete(tree.b(month_rel))
        homes[""] = homes[min(d for d in homes)]  # a link to the month lands on its earliest day
        mapping[month_rel] = homes
    return mapping


# -- step 2: links to days -----------------------------------------------------------

def _step_links(tree: _Tree, mapping: dict[str, dict[str, str]]) -> None:
    if not mapping:
        return
    for repo_rel in tree.list_md():
        doc_rel = repo_rel[len(tree.bundle_rel) + 1:] if tree.bundle_rel else repo_rel
        text = tree.read(repo_rel)
        if text is None:
            continue

        def to_day(target: str, _doc=doc_rel) -> str | None:
            if not _is_local(target):
                return None
            path, _, frag = target.partition("#")
            homes = mapping.get(_resolve(_doc, path)) if path else None
            if homes is None:
                return None
            new_rel = homes.get(frag) if _DAY.match(frag) else None
            return _relative(new_rel or homes[""], _doc)

        new_text, count = _rewrite_links(text, to_day)
        if count:
            tree.write(repo_rel, new_text)
            tree.actions.append(f"rewrite links in {doc_rel} ({count})")


# -- step 3: to-dos into the brain ---------------------------------------------------

def _step_todos(tree: _Tree, today: str) -> None:
    open_rel = tree.b("todo/open.md")
    index_rel = tree.b("todo/index.md")
    if not tree.exists(open_rel):
        parked = tree.read("_todo.md")
        if parked is not None:
            body = _trim(_drop_title(parked.split("\n")))
            text = "\n".join(body)

            def re_root(target: str) -> str | None:
                if not _is_local(target) or target.startswith("/"):
                    return None
                path, _, frag = target.partition("#")
                if not path:
                    return None
                moved = _relative(posixpath.normpath(path), open_rel)
                return moved + (f"#{frag}" if frag else "")

            text, _ = _rewrite_links(text, re_root)  # `_todo.md` sat at P; open.md sits at R/todo/
            tree.write(open_rel, TODO_OPEN_HEAD.format(today=today) + (f"\n{text}\n" if text else ""))
            tree.delete("_todo.md")
            tree.actions.append("move _todo.md → todo/open.md")
            ignore = tree.read(".gitignore")
            if ignore is not None:
                kept = [ln for ln in ignore.split("\n") if ln.strip() != "_todo.md"]
                if len(kept) != len(ignore.split("\n")):
                    tree.write(".gitignore", "\n".join(kept))
                    tree.actions.append("unignore _todo.md in .gitignore")
        else:
            tree.write(open_rel, TODO_OPEN_HEAD.format(today=today))
            tree.actions.append("create todo/open.md")
    if not tree.exists(index_rel):
        tree.write(index_rel, TODO_INDEX)
        tree.actions.append("create todo/index.md")


def _drop_title(lines: list[str]) -> list[str]:
    if lines and lines[0].startswith("# "):
        return lines[1:]
    return lines


# -- step 4: the stamp ---------------------------------------------------------------

def _step_stamp(tree: _Tree, old: int, new: int) -> None:
    text = tree.read("brainpick.toml")
    if text is None:
        raise MigrateError("no brainpick.toml to stamp")
    lines = text.split("\n")
    in_brain = False
    for i, line in enumerate(lines):
        if _ANY_SECTION.match(line):
            in_brain = bool(_BRAIN_SECTION.match(line))
            continue
        m = _FORMAT_LINE.match(line) if in_brain else None
        if m and int(m.group(2)) == old:
            lines[i] = f"{m.group(1)}{new}{m.group(3)}"
            tree.write("brainpick.toml", "\n".join(lines))
            tree.actions.append(f"stamp brainpick.toml: format {old} → {new}")
            return
    raise MigrateError(f"brainpick.toml has no `format = {old}` under [brain] to stamp")


def _migrate_1_to_2(tree: _Tree, today: str) -> None:
    mapping = _step_journals(tree, today)
    _step_links(tree, mapping)
    _step_todos(tree, today)
    _step_stamp(tree, 1, 2)


MIGRATIONS: dict[int, Callable[[_Tree, str], None]] = {2: _migrate_1_to_2}  # target → step from target-1


# -- the command -----------------------------------------------------------------------

def resolve_today(env=None) -> str:
    env = os.environ if env is None else env
    value = env.get(ENV_TODAY, "").strip()
    if value and _DAY.match(value):
        return value
    return date.today().isoformat()


def migrate(root: str | Path, to: int, today: str | None = None, dry_run: bool = False,
            config: Config | None = None) -> MigrateReport:
    """Rewrite the brain at `root` (a repo root or the bundle itself, spec/80) from
    its stamped format up to `to`. Returns the actions taken (or previewed)."""
    repo = Path(root).resolve()
    bundle, config = resolve_bundle(repo) if config is None else ((repo / config.bundle.root).resolve(), config)
    current = config.brain.format
    if current <= 0:
        raise MigrateError(f"{repo} is not a brain: no [brain] format in brainpick.toml (spec/85)")
    if to < current:
        raise MigrateError(f"target format {to} is below the bundle's current format {current}; "
                           "migrate never downgrades")
    report = MigrateReport(from_format=current, to_format=to, dry_run=dry_run)
    if to == current:
        return report
    for step in range(current + 1, to + 1):
        if step not in MIGRATIONS:
            raise MigrateError(f"unknown brain format {step}; this engine knows formats up to {LATEST_FORMAT}")
    today = today or resolve_today()
    try:
        bundle_rel = bundle.relative_to(repo).as_posix()
    except ValueError as exc:
        raise MigrateError(f"bundle {bundle} is not under {repo}") from exc
    tree = _Tree(repo, "" if bundle_rel == "." else bundle_rel)
    for step in range(current + 1, to + 1):
        MIGRATIONS[step](tree, today)
    report.actions = list(tree.actions)
    report.diff = tree.diff()
    if not dry_run:
        tree.apply()
    return report
