"""Timeline (spec/90): git history distilled, oldest-first, advisory content.

Every test builds its own throwaway git repo with FIXED author/committer dates,
so results are deterministic and wholly independent of the outer repo's history
(hermetic: no network, no reliance on brainpick's own git log).
"""
import os
import subprocess
from pathlib import Path

import pytest

from brainpick.timeline import build_timeline, doc_at_commit

C1 = "2026-07-02T20:41:00+00:00"
C2 = "2026-07-03T09:12:00+00:00"
C3 = "2026-07-04T10:00:00+00:00"
Z1 = "2026-07-02T20:41:00Z"
Z2 = "2026-07-03T09:12:00Z"
Z3 = "2026-07-04T10:00:00Z"


def _git(repo: Path, *args: str, env: dict | None = None) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True, env=env)


def _commit(repo: Path, message: str, date: str) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date,
        "GIT_AUTHOR_NAME": "Tester", "GIT_AUTHOR_EMAIL": "t@e.st",
        "GIT_COMMITTER_NAME": "Tester", "GIT_COMMITTER_EMAIL": "t@e.st",
    }
    _git(repo, "add", "-A", env=env)
    _git(repo, "commit", "-m", message, env=env)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    r = tmp_path / "brain"
    r.mkdir()
    _git(r, "init", "-q")
    _git(r, "config", "user.name", "Tester")
    _git(r, "config", "user.email", "t@e.st")
    return r


def test_commits_chronological_with_per_commit_status(repo: Path):
    (repo / "a.md").write_text("# A\n\nLinks to [B](b.md).\n", encoding="utf-8")
    (repo / "b.md").write_text("# B\n\nThe bee document about buzzing.\n", encoding="utf-8")
    _commit(repo, "Founding commit", C1)
    (repo / "a.md").write_text("# A\n\nLinks to [B](b.md), now with more text.\n", encoding="utf-8")
    _commit(repo, "Modify a", C2)
    (repo / "b.md").unlink()
    (repo / "c.md").write_text("# C\n\nCompletely different comet content here.\n", encoding="utf-8")
    _commit(repo, "Delete b add c", C3)

    tl = build_timeline(repo, repo)
    assert tl is not None
    commits = tl["commits"]
    assert len(commits) == 3
    # oldest-first
    assert [c["message"] for c in commits] == ["Founding commit", "Modify a", "Delete b add c"]
    assert all(len(c["sha"]) == 7 for c in commits)
    assert all(c["author"] == "Tester" for c in commits)

    assert commits[0]["added"] == ["a.md", "b.md"]
    assert commits[0]["modified"] == [] and commits[0]["deleted"] == []
    assert commits[0]["date"] == Z1

    assert commits[1]["modified"] == ["a.md"]
    assert commits[1]["added"] == [] and commits[1]["deleted"] == []
    assert commits[1]["date"] == Z2

    assert commits[2]["added"] == ["c.md"]
    assert commits[2]["deleted"] == ["b.md"]
    assert commits[2]["modified"] == []
    assert commits[2]["date"] == Z3


def test_docs_lifecycle_and_span(repo: Path):
    (repo / "a.md").write_text("# A\n\nLinks to [B](b.md).\n", encoding="utf-8")
    (repo / "b.md").write_text("# B\n\nThe bee document about buzzing.\n", encoding="utf-8")
    _commit(repo, "Founding commit", C1)
    (repo / "a.md").write_text("# A\n\nLinks to [B](b.md), now with more text.\n", encoding="utf-8")
    _commit(repo, "Modify a", C2)
    (repo / "b.md").unlink()
    (repo / "c.md").write_text("# C\n\nCompletely different comet content here.\n", encoding="utf-8")
    _commit(repo, "Delete b add c", C3)

    tl = build_timeline(repo, repo)
    assert tl is not None
    assert tl["docs"]["a.md"] == {"created": Z1, "deleted": None, "modified": [Z2]}
    assert tl["docs"]["b.md"] == {"created": Z1, "deleted": Z3, "modified": []}
    assert tl["docs"]["c.md"] == {"created": Z3, "deleted": None, "modified": []}
    assert tl["span"] == {"commits": 3, "first": Z1, "last": Z3}


def test_reserved_and_non_md_are_excluded(repo: Path):
    (repo / "a.md").write_text("# A\n", encoding="utf-8")
    (repo / "index.md").write_text("# Index\n", encoding="utf-8")  # reserved
    (repo / "log.md").write_text("# Log\n", encoding="utf-8")      # reserved
    (repo / "notes.txt").write_text("plain text, not a doc\n", encoding="utf-8")
    _commit(repo, "Founding commit", C1)

    tl = build_timeline(repo, repo)
    assert tl is not None
    assert tl["commits"][0]["added"] == ["a.md"]  # index.md / log.md / notes.txt dropped
    assert set(tl["docs"]) == {"a.md"}


def test_bundle_in_subdir_maps_to_bundle_relative(repo: Path):
    (repo / "docs").mkdir()
    (repo / "docs" / "x.md").write_text("# X\n", encoding="utf-8")
    (repo / "outside.md").write_text("# Outside the bundle\n", encoding="utf-8")
    _commit(repo, "Founding commit", C1)

    tl = build_timeline(repo / "docs", repo)  # bundle = repo/docs, repo = repo
    assert tl is not None
    assert tl["commits"][0]["added"] == ["x.md"]  # docs/x.md -> x.md, outside.md scoped out
    assert set(tl["docs"]) == {"x.md"}


def test_rename_splits_into_delete_and_add(repo: Path):
    (repo / "a.md").write_text(
        "# A\n\nEnough shared content that git detects the rename as a rename.\n",
        encoding="utf-8",
    )
    _commit(repo, "Add a", C1)
    _git(repo, "mv", "a.md", "renamed.md")
    _commit(repo, "Rename a to renamed", C2)

    tl = build_timeline(repo, repo)
    assert tl is not None
    rename = tl["commits"][1]
    assert rename["deleted"] == ["a.md"]
    assert rename["added"] == ["renamed.md"]
    assert tl["docs"]["a.md"]["deleted"] == Z2
    assert tl["docs"]["renamed.md"]["created"] == Z2


def test_non_git_bundle_returns_none(tmp_path: Path):
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "a.md").write_text("# A\n", encoding="utf-8")
    assert build_timeline(plain, None) is None       # no repo root at all
    assert build_timeline(plain, plain) is None       # a dir that is not a git work tree


def test_no_bundle_history_returns_none(repo: Path):
    # A repo whose only commit touches a file OUTSIDE the bundle subdir has no
    # bundle history to distill.
    (repo / "elsewhere.txt").write_text("not markdown\n", encoding="utf-8")
    _commit(repo, "Unrelated", C1)
    (repo / "docs").mkdir()
    assert build_timeline(repo / "docs", repo) is None


def _head(repo: Path) -> str:
    out = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=repo, check=True, capture_output=True, text=True,
    )
    return out.stdout.strip()


# --- doc_at_commit (spec/50 "Doc versions" — the file-level Time Machine) ---

def test_doc_at_commit_serves_each_version(repo: Path):
    (repo / "a.md").write_text("---\ntitle: A\n---\n\nversion one\n", encoding="utf-8")
    _commit(repo, "Add a", C1)
    sha1 = _head(repo)
    (repo / "a.md").write_text("---\ntitle: A\n---\n\nversion two\n", encoding="utf-8")
    _commit(repo, "Modify a", C2)
    sha2 = _head(repo)

    assert "version one" in (doc_at_commit(repo, repo, "a.md", sha1) or "")
    assert "version two" in (doc_at_commit(repo, repo, "a.md", sha2) or "")


def test_doc_at_commit_none_when_file_absent_at_that_commit(repo: Path):
    (repo / "a.md").write_text("# A\n", encoding="utf-8")
    _commit(repo, "Add a", C1)
    sha1 = _head(repo)
    (repo / "b.md").write_text("# B\n", encoding="utf-8")
    _commit(repo, "Add b", C2)

    assert doc_at_commit(repo, repo, "b.md", sha1) is None  # b did not exist yet


def test_doc_at_commit_none_for_unknown_commit_or_no_repo(repo: Path, tmp_path: Path):
    (repo / "a.md").write_text("# A\n", encoding="utf-8")
    _commit(repo, "Add a", C1)
    assert doc_at_commit(repo, repo, "a.md", "deadbee") is None

    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "a.md").write_text("# A\n", encoding="utf-8")
    assert doc_at_commit(plain, None, "a.md", "deadbee") is None


def test_doc_at_commit_resolves_a_nested_bundle_prefix(repo: Path):
    docs = repo / "docs"
    docs.mkdir()
    (docs / "a.md").write_text("nested v1\n", encoding="utf-8")
    _commit(repo, "Add docs/a", C1)
    sha1 = _head(repo)
    (docs / "a.md").write_text("nested v2\n", encoding="utf-8")
    _commit(repo, "Modify docs/a", C2)

    assert doc_at_commit(docs, repo, "a.md", sha1) == "nested v1\n"
