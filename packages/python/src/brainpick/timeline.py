"""Timeline (spec/90): the bundle's git history distilled into a shape the UI can
travel through — the Time Machine.

Advisory by construction: git history differs across clones, is absent in a
non-repo bundle, and is not bundle content — so `timeline.json` is never
byte-golden or conformance-tested for content, only for layout. One `git log`
over the bundle path, parsed; any failure (no repo, missing git, unreadable
history) logs and yields `None`, and T1 simply omits the file.
"""
from __future__ import annotations

import logging
import os
import posixpath
import subprocess
from datetime import datetime, timezone
from fnmatch import fnmatch
from pathlib import Path

logger = logging.getLogger(__name__)

# The reserved generated docs are build output, not knowledge — the graph never
# treats them as nodes, and neither does the timeline (spec/20 + spec/90).
RESERVED_NAMES = {"index.md", "log.md"}

_RECORD_SEP = "\x01"  # between commits — survives any subject text
_FIELD_SEP = "\x1f"   # between a commit's header fields
# spec/90 prints %H %aI %an %s per commit; the \x01/\x1f separators make the
# name-status stream (tab-separated, one path per line) unambiguous to parse.
_GIT_FORMAT = f"{_RECORD_SEP}%H{_FIELD_SEP}%aI{_FIELD_SEP}%an{_FIELD_SEP}%s"
# NOTE (deviation from spec/90's literal command): spec/90 writes
# `--diff-filter=AMD`, but AMD excludes status R, so `-M`-detected renames are
# dropped entirely — which contradicts the spec's own rule that a rename is
# recorded as delete(old)+add(new). We include R (AMDR) so renames survive and
# are split as documented. Flagged for a spec amendment.
_DIFF_FILTER = "AMDR"


def build_timeline(
    bundle_root: str | Path,
    repo_root: str | Path | None,
    include_globs: tuple[str, ...] = ("*.md",),
    excludes: tuple[str, ...] = (),
) -> dict | None:
    """Distill git history for `bundle_root` into `timeline.json`'s shape, or
    `None` when there is no readable history. Never raises — advisory (spec/90)."""
    if repo_root is None:
        return None
    try:
        bundle = Path(bundle_root).resolve()
        repo = Path(repo_root).resolve()
        prefix = os.path.relpath(bundle, repo).replace(os.sep, "/")
        if prefix.startswith(".."):
            return None  # bundle is not inside the repo — nothing to scope to
        pathspec = "." if prefix in ("", ".") else prefix
        output = _run_git_log(repo, pathspec)
        if output is None:
            return None
        commits = _parse_commits(output, prefix, tuple(include_globs), tuple(excludes))
        if not commits:
            return None
        docs = _lifecycle(commits)
        span = {"commits": len(commits), "first": commits[0]["date"], "last": commits[-1]["date"]}
        return {"commits": commits, "docs": docs, "span": span}
    except Exception as error:  # advisory: git surprises never break the compile
        logger.debug("timeline: skipped (%s)", error)
        return None


def doc_at_commit(
    bundle_root: str | Path,
    repo_root: str | Path | None,
    path: str,
    at: str,
) -> str | None:
    """The doc's text AS OF a commit (spec/50 "Doc versions" — the file-level
    Time Machine), read via `git show <sha>:<prefix>/<path>` with the same
    repo-root + bundle-prefix scoping build_timeline uses. None when there is
    no repo, the commit is unknown, or the file did not exist at that commit —
    advisory like the timeline itself, never raises."""
    if repo_root is None:
        return None
    try:
        bundle = Path(bundle_root).resolve()
        repo = Path(repo_root).resolve()
        prefix = os.path.relpath(bundle, repo).replace(os.sep, "/")
        if prefix.startswith(".."):
            return None
        rel = path if prefix in ("", ".") else f"{prefix}/{path}"
        proc = subprocess.run(
            ["git", "-c", "core.quotePath=false", "show", f"{at}:{rel}"],
            cwd=str(repo), capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
        if proc.returncode != 0:
            return None
        return proc.stdout
    except Exception as error:  # advisory: git surprises never break a request
        logger.debug("timeline: doc_at_commit skipped (%s)", error)
        return None


def _run_git_log(repo: Path, pathspec: str) -> str | None:
    """The single `git log` (spec/90). Non-zero exit / missing git → None."""
    cmd = [
        "git", "-c", "core.quotePath=false", "log",
        f"--diff-filter={_DIFF_FILTER}", "--name-status", "-M",
        f"--format={_GIT_FORMAT}", "--", pathspec,
    ]
    try:
        proc = subprocess.run(
            cmd, cwd=str(repo), capture_output=True, text=True,
            encoding="utf-8", errors="replace", check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        logger.debug("timeline: git log failed (%s) — omitting timeline.json", error)
        return None
    return proc.stdout


def _parse_commits(
    output: str, prefix: str, include_globs: tuple[str, ...], excludes: tuple[str, ...],
) -> list[dict]:
    commits: list[dict] = []
    for chunk in output.split(_RECORD_SEP):
        if not chunk.strip():
            continue
        lines = chunk.split("\n")
        fields = lines[0].split(_FIELD_SEP, 3)
        if len(fields) < 4:
            continue
        sha_full, date_raw, author, message = fields

        added: set[str] = set()
        modified: set[str] = set()
        deleted: set[str] = set()
        for line in lines[1:]:
            if line.strip():
                _apply_status(line, prefix, include_globs, excludes, added, modified, deleted)
        if not (added or modified or deleted):
            continue  # a commit that touched no bundle knowledge docs is omitted

        commits.append({
            "added": sorted(added),
            "author": author,
            "date": _normalize_date(date_raw),
            "deleted": sorted(deleted),
            "message": message,
            "modified": sorted(modified),
            "sha": sha_full[:7],
        })
    commits.reverse()  # git log is newest-first; the timeline is oldest-first
    return commits


def _apply_status(
    line: str, prefix: str, include_globs: tuple[str, ...], excludes: tuple[str, ...],
    added: set[str], modified: set[str], deleted: set[str],
) -> None:
    parts = line.split("\t")
    if len(parts) < 2:
        return
    code = parts[0][:1]
    if code == "R" and len(parts) >= 3:  # rename → delete(old) + add(new) (spec/90)
        old = _bundle_relative(parts[1], prefix)
        new = _bundle_relative(parts[2], prefix)
        if old and _is_knowledge_doc(old, include_globs, excludes):
            deleted.add(old)
        if new and _is_knowledge_doc(new, include_globs, excludes):
            added.add(new)
        return
    path = _bundle_relative(parts[1], prefix)
    if not path or not _is_knowledge_doc(path, include_globs, excludes):
        return
    if code == "A":
        added.add(path)
    elif code == "M":
        modified.add(path)
    elif code == "D":
        deleted.add(path)


def _bundle_relative(repo_path: str, prefix: str) -> str | None:
    """git prints repo-relative POSIX paths; strip the bundle's prefix."""
    if prefix in ("", "."):
        return repo_path
    if repo_path == prefix:
        return ""  # the bundle directory itself, never a doc
    marker = prefix + "/"
    if repo_path.startswith(marker):
        return repo_path[len(marker):]
    return None  # outside the bundle (the pathspec should prevent this)


def _is_knowledge_doc(
    path: str, include_globs: tuple[str, ...], excludes: tuple[str, ...],
) -> bool:
    if posixpath.basename(path) in RESERVED_NAMES:
        return False
    if not _match_include(path, include_globs):
        return False
    return not any(fnmatch(path, ex) for ex in excludes)


def _match_include(path: str, include_globs: tuple[str, ...]) -> bool:
    for glob in include_globs:
        # fnmatch's `*` already spans `/`, so a pathlib-style recursive `**/`
        # prefix (the config default `**/*.md`) is equivalent to dropping it.
        simplified = glob[3:] if glob.startswith("**/") else glob
        if fnmatch(path, glob) or fnmatch(path, simplified):
            return True
    return False


def _normalize_date(raw: str) -> str:
    """%aI is strict ISO 8601 with an offset (or `Z`); normalize to UTC `Z`."""
    dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _lifecycle(commits: list[dict]) -> dict:
    """Per-doc created/modified/deleted, derived from the chronological commits
    (convenience for the UI, spec/90). `created` = first add, `modified` = later
    change dates (sorted), `deleted` = the delete date or null."""
    docs: dict[str, dict] = {}
    for commit in commits:  # oldest-first
        date = commit["date"]
        for path in commit["added"]:
            entry = docs.get(path)
            if entry is None:
                docs[path] = {"created": date, "deleted": None, "modified": []}
            else:  # re-added after a delete — it exists again; keep the first created
                entry["deleted"] = None
        for path in commit["modified"]:
            entry = docs.get(path)
            if entry is None:  # a modify with no recorded add (truncated history)
                docs[path] = {"created": date, "deleted": None, "modified": []}
            else:
                entry["modified"].append(date)
        for path in commit["deleted"]:
            entry = docs.get(path)
            if entry is None:
                docs[path] = {"created": date, "deleted": date, "modified": []}
            else:
                entry["deleted"] = date
    for entry in docs.values():
        entry["modified"].sort()
    return docs
