"""`brainpick migrate --to N` (spec/85 *Versioning and migration*): the one command
that rewrites committed bytes — deterministic, mechanical, writes by default,
--dry-run previews. The format-1 → 2 rewrite is pinned by the migrate
conformance case; these tests cover the edges the golden tree cannot."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from brainpick.cli import main
from brainpick.migrate import MigrateError, migrate, split_month

from conftest import FIXTURE_BUNDLES

TODAY = "2026-07-02"


@pytest.fixture
def v1(tmp_path):
    root = tmp_path / "kotiaivot-v1"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot-v1", root)
    (root / "gitignore").rename(root / ".gitignore")
    return root


def _tree(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)).replace("\\", "/"): p.read_text(encoding="utf-8")
            for p in sorted(root.rglob("*")) if p.is_file()}


# -- split_month: the pure function behind step 1 -----------------------------------

def test_split_month_by_day_headings_promotes_subheadings():
    text = ("# 2026-07\n\n## 2026-07-02\n\n* two\n\n### Evening\n\n* late\n\n"
            "## 2026-07-01\n\n* one\n")
    days = split_month(text, "2026-07")
    assert [d for d, _ in days] == ["2026-07-02", "2026-07-01"]
    assert days[0][1] == "# 2026-07-02\n\n* two\n\n## Evening\n\n* late\n"
    assert days[1][1] == "# 2026-07-01\n\n* one\n"


def test_split_month_keeps_a_non_title_preamble_and_non_date_h2():
    text = "Some intro.\n\n## 2026-07-01\n\n* one\n\n## Not a date\n\n* still day one\n"
    days = split_month(text, "2026-07")
    assert len(days) == 1
    assert days[0][1] == "# 2026-07-01\n\nSome intro.\n\n* one\n\n## Not a date\n\n* still day one\n"


def test_split_month_without_day_headings_is_the_first_day():
    days = split_month("# 2026-07\n\n* a note\n", "2026-07")
    assert days == [("2026-07-01", "# 2026-07-01\n\n* a note\n")]


# -- the 1 → 2 rewrite ------------------------------------------------------------

def test_migrate_1_to_2_moves_days_todos_and_bumps_the_stamp(v1):
    report = migrate(v1, to=2, today=TODAY)
    tree = _tree(v1)
    assert "journals/2026-07.md" not in tree and "journals/archive/2026-06.md" not in tree
    assert "journals/2026-07-02.md" in tree  # today stays at the top
    assert "journals/archive/2026/07/2026-07-01.md" in tree
    assert "journals/archive/2026/06/2026-06-30.md" in tree
    # links inside moved sections are re-rooted so they still land
    assert "(../../../../skills/veden-keitto.md)" in tree["journals/archive/2026/07/2026-07-01.md"]
    assert "(../knowledge/vieraat.md)" in tree["journals/2026-07-02.md"]
    assert "(../../../../knowledge/kahvi.md)" in tree["journals/archive/2026/06/2026-06-30.md"]
    # links to day sections and to the month are rewritten, text untouched
    kahvi = tree["knowledge/kahvi.md"]
    assert "[one evening](../journals/2026-07-02.md)" in kahvi
    assert "[June](../journals/archive/2026/06/2026-06-30.md)" in kahvi
    assert "[July journal](../journals/archive/2026/07/2026-07-01.md)" in kahvi
    assert "#2026" not in kahvi
    # _todo.md → todo/open.md
    assert "_todo.md" not in tree
    assert tree["todo/open.md"].startswith("---\ntype: todo\ntitle: Open\n")
    assert f"timestamp: {TODAY}T00:00:00Z" in tree["todo/open.md"]
    assert "# Parking lot" not in tree["todo/open.md"] and "# Open\n" in tree["todo/open.md"]
    assert "- [ ] Descale the kettle — see [Veden keitto](../skills/veden-keitto.md)" in tree["todo/open.md"]
    assert "- [Open](open.md)" in tree["todo/index.md"]
    assert "_todo.md" not in tree[".gitignore"] and "_temp/" in tree[".gitignore"]
    assert "format = 2              # the brainpick brain format (spec/85)" in tree["brainpick.toml"]
    assert report.actions[0].startswith("split journals/2026-07.md")
    assert report.actions[-1] == "stamp brainpick.toml: format 1 → 2"
    assert not report.dry_run


def test_migrate_is_idempotent_and_a_no_op_at_target(v1):
    migrate(v1, to=2, today=TODAY)
    before = _tree(v1)
    report = migrate(v1, to=2, today=TODAY)
    assert report.actions == [] and _tree(v1) == before


def test_dry_run_writes_nothing_but_lists_actions_and_a_diff(v1):
    before = _tree(v1)
    report = migrate(v1, to=2, today=TODAY, dry_run=True)
    assert _tree(v1) == before
    assert report.dry_run and report.actions
    assert "--- knowledge/kahvi.md" in report.diff and "+++ knowledge/kahvi.md" in report.diff
    assert "--- journals/2026-07.md" in report.diff  # a deleted file diffs against nothing


def test_refuses_a_downgrade_and_a_non_brain(v1, tmp_path):
    migrate(v1, to=2, today=TODAY)
    with pytest.raises(MigrateError, match="below"):
        migrate(v1, to=1, today=TODAY)
    wiki = tmp_path / "wiki"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", wiki)
    with pytest.raises(MigrateError, match="not a brain"):
        migrate(wiki, to=2, today=TODAY)
    with pytest.raises(MigrateError, match="unknown"):
        migrate(v1, to=9, today=TODAY)


def test_migrate_without_a_todo_seeds_an_empty_list(v1):
    (v1 / "_todo.md").unlink()
    migrate(v1, to=2, today=TODAY)
    open_md = (v1 / "todo" / "open.md").read_text(encoding="utf-8")
    assert open_md.endswith("# Open\n") and "type: todo" in open_md


def test_migrate_resolves_the_bundle_below_a_repo_root(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot-v1", repo / "_brain")
    (repo / "_brain" / "gitignore").rename(repo / ".gitignore")
    (repo / "_brain" / "_todo.md").rename(repo / "_todo.md")
    (repo / "brainpick.toml").write_text('spec = "0.1"\n\n[bundle]\nroot = "_brain"\n\n[brain]\nformat = 1\n',
                                          encoding="utf-8")
    (repo / "_brain" / "brainpick.toml").unlink()
    migrate(repo, to=2, today=TODAY)
    assert (repo / "_brain" / "todo" / "open.md").is_file()
    assert not (repo / "_todo.md").exists()
    assert "format = 2" in (repo / "brainpick.toml").read_text(encoding="utf-8")
    assert "_todo.md" not in (repo / ".gitignore").read_text(encoding="utf-8")


# -- the CLI ------------------------------------------------------------------------

def test_cli_migrate_prints_actions_and_honours_env_today(v1, capsys, monkeypatch):
    monkeypatch.setenv("BRAINPICK_TODAY", TODAY)
    assert main(["migrate", "--to", "2", "--root", str(v1)]) == 0
    out = capsys.readouterr().out
    assert "split journals/2026-07.md" in out and "stamp brainpick.toml: format 1 → 2" in out
    assert "migrated to format 2" in out and "brainpick compile" in out
    assert (v1 / "journals" / "2026-07-02.md").is_file()


def test_cli_dry_run_and_errors(v1, capsys, monkeypatch):
    monkeypatch.setenv("BRAINPICK_TODAY", TODAY)
    before = _tree(v1)
    assert main(["migrate", "--to", "2", "--root", str(v1), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "dry run" in out and "+++ knowledge/kahvi.md" in out
    assert _tree(v1) == before
    assert main(["migrate", "--to", "1", "--root", str(v1)]) == 0  # already there: a no-op that says so
    assert "already at format 1" in capsys.readouterr().out
    main(["migrate", "--to", "2", "--root", str(v1)])
    capsys.readouterr()
    assert main(["migrate", "--to", "1", "--root", str(v1)]) == 1
    assert "below" in capsys.readouterr().err
