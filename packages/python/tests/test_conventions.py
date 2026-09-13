"""Conventions (spec/85 *Conventions*, spec/20 *t1/conventions.json*): a
`type: convention` doc is a standing rule the engine lists before anything
else — in the overview, in the AGENTS.md report — so an agent reads the rules
before it acts. Format 2 → 3 makes the template's `conventions/` a type the
engine recognises. The engine never edits a convention."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from brainpick.cli import main
from brainpick.compile.conventions import build_conventions, is_convention
from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.compile.t1 import render_report_block
from brainpick.config import load_config
from brainpick.core.bundle import scan
from brainpick.mcp_server import overview_payload
from brainpick.migrate import LATEST_FORMAT, migrate
from brainpick.serve.state import ServeState

from conftest import FIXTURE_BUNDLES

TODAY = "2026-07-02"


def _state(root: Path) -> ServeState:
    run_compile(root)
    state = ServeState(root, load_config(root))
    state.reload_artifacts()
    return state


@pytest.fixture
def v2(tmp_path):
    root = tmp_path / "kotiaivot-v2"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot-v2", root)
    (root / "gitignore").rename(root / ".gitignore")
    return root


# -- recognition ------------------------------------------------------------------


@pytest.mark.parametrize("value,expected", [
    ("convention", True), ("Convention", True), ("CONVENTION ", True),
    ("decision", False), ("skill", False), (None, False), ("", False),
])
def test_is_convention_is_keyed_on_type_case_insensitively(value, expected):
    assert is_convention(value) is expected


def test_scan_flags_convention_docs_wherever_they_live(tmp_path):
    (tmp_path / "rule.md").write_text("---\ntype: convention\ntitle: R\n---\n# R\n", encoding="utf-8")
    (tmp_path / "adr.md").write_text("---\ntype: decision\ntitle: A\n---\n# A\n", encoding="utf-8")
    flags = {d.path: d.convention for d in scan(tmp_path)}
    assert flags == {"rule.md": True, "adr.md": False}


# -- the artifact -----------------------------------------------------------------


def test_build_conventions_sorted_by_path_with_null_descriptions(kotiaivot):
    (kotiaivot / "conventions" / "b-rule.md").write_text(
        "---\ntype: convention\ntitle: B\n---\n# B\n", encoding="utf-8")
    docs = scan(kotiaivot, exclude=("raw/*",))
    assert build_conventions(docs) == {"conventions": [
        {"description": "Coffee is offered before anything else is said — to guests and to the household alike.",
         "path": "conventions/aamukahvi-ensin.md", "title": "Aamukahvi ensin"},
        {"description": None, "path": "conventions/b-rule.md", "title": "B"},
    ]}


def test_compile_writes_conventions_json_and_it_counts_for_freshness(kotiaivot):
    run_compile(kotiaivot)
    artifact = kotiaivot / ".brainpick" / "t1" / "conventions.json"
    data = json.loads(artifact.read_text(encoding="utf-8"))
    assert [c["path"] for c in data["conventions"]] == ["conventions/aamukahvi-ensin.md"]
    assert check_fresh(kotiaivot).fresh
    artifact.write_text('{"conventions": []}', encoding="utf-8")
    assert not check_fresh(kotiaivot).fresh


def test_a_wiki_writes_an_empty_artifact(kotiaurinko):
    run_compile(kotiaurinko)
    artifact = kotiaurinko / ".brainpick" / "t1" / "conventions.json"
    assert json.loads(artifact.read_text(encoding="utf-8")) == {"conventions": []}


# -- surfaces ---------------------------------------------------------------------


def test_overview_lists_conventions_before_skills_and_says_so(kotiaivot):
    result = overview_payload(_state(kotiaivot))
    assert result["conventions"] == [{
        "path": "conventions/aamukahvi-ensin.md", "title": "Aamukahvi ensin",
        "description": "Coffee is offered before anything else is said — to guests and to the household alike.",
    }]
    keys = list(result)
    assert keys.index("conventions") < keys.index("skills")
    assert result["hint"].startswith("1 convention applies — read it before acting")
    assert result["hint"].index("convention") < result["hint"].index("skills")


def test_overview_without_conventions_is_empty_and_silent(kotiaurinko):
    result = overview_payload(_state(kotiaurinko))
    assert result["conventions"] == []
    assert "convention" not in result["hint"]


def test_overview_survives_budget_trimming_with_conventions_intact(kotiaivot):
    result = overview_payload(_state(kotiaivot), budget_tokens=60)
    assert result["conventions"] and all(not g["docs"] for g in result["tree"])


def test_overview_reads_a_stale_artifact_as_no_conventions(kotiaivot):
    run_compile(kotiaivot)
    (kotiaivot / ".brainpick" / "t1" / "conventions.json").unlink()
    state = ServeState(kotiaivot, load_config(kotiaivot))
    state.reload_artifacts()
    assert overview_payload(state)["conventions"] == []


def test_report_lists_conventions_above_skills_only_when_there_are_any():
    graph = {"nodes": [], "edges": [], "stats": {"docs": 0, "edges": 0, "tags": 0, "orphans": 0, "ghosts": 0},
             "ghosts": [], "orphans": []}
    tiers = {"t1": "fresh", "t2": "off", "t3": "off"}
    conventions = {"conventions": [{"description": None, "path": "conventions/a.md", "title": "A"}]}
    skills = {"skills": [{"depends_on": [], "description": None, "export": [], "path": "skills/s.md",
                          "title": "S", "tools": []}]}
    block = render_report_block(graph, tiers, ".", None, skills=skills, conventions=conventions)
    assert "- Conventions (these apply to you):\n  - A (conventions/a.md)\n" in block
    assert block.index("Conventions") < block.index("Skills")
    assert "Conventions" not in render_report_block(graph, tiers, ".", None, skills=skills)


def test_cli_overview_prints_the_conventions(kotiaivot, capsys):
    run_compile(kotiaivot)
    assert main(["overview", "--root", str(kotiaivot)]) == 0
    out = capsys.readouterr().out
    assert "conventions (these apply to you):" in out
    assert "Aamukahvi ensin (conventions/aamukahvi-ensin.md)" in out
    assert out.index("conventions") < out.index("skills")


# -- migrate 2 → 3 ----------------------------------------------------------------


def test_latest_format_is_3():
    assert LATEST_FORMAT == 3


def test_migrate_2_to_3_retypes_the_template_stamp_and_seeds_the_index(v2):
    report = migrate(v2, to=3, today=TODAY)
    rule = (v2 / "conventions" / "aamukahvi-ensin.md").read_text(encoding="utf-8")
    assert rule.startswith("---\ntype: convention\ntitle: Aamukahvi ensin\n")
    essay = (v2 / "conventions" / "hiljainen-tunti.md").read_text(encoding="utf-8")
    assert essay.startswith("---\ntype: article\n")  # the author's type is never touched
    index = (v2 / "conventions" / "index.md").read_text(encoding="utf-8")
    assert index.startswith("# Conventions\n") and "* (none yet)" in index
    toml = (v2 / "brainpick.toml").read_text(encoding="utf-8")
    assert "format = 3              # the brainpick brain format (spec/85)" in toml
    assert "skills = 0              # procedural memory never fades\nconventions = 0         # rules never fade\n" in toml
    assert toml.index("conventions = 0") < toml.index("[index]")
    assert report.actions == [
        "retype conventions/aamukahvi-ensin.md: decision → convention",
        "create conventions/index.md",
        "stamp brainpick.toml: format 2 → 3",
        "add conventions = 0 to [half_life.folders]",
    ]


def test_migrate_2_to_3_leaves_an_existing_index_and_key_alone(v2):
    (v2 / "conventions" / "index.md").write_text("# Mine\n", encoding="utf-8")
    toml = v2 / "brainpick.toml"
    toml.write_text(toml.read_text(encoding="utf-8").replace("skills = 0", "conventions = 7\nskills = 0"),
                    encoding="utf-8")
    report = migrate(v2, to=3, today=TODAY)
    assert (v2 / "conventions" / "index.md").read_text(encoding="utf-8") == "# Mine\n"
    assert "conventions = 0" not in toml.read_text(encoding="utf-8")
    assert "create conventions/index.md" not in report.actions
    assert not any(a.startswith("add conventions") for a in report.actions)


def test_migrate_2_to_3_without_a_folders_table_adds_nothing(v2):
    toml = v2 / "brainpick.toml"
    text = toml.read_text(encoding="utf-8")
    start, end = text.index("[half_life]"), text.index("[index]")
    toml.write_text(text[:start] + text[end:], encoding="utf-8")
    report = migrate(v2, to=3, today=TODAY)
    assert "half_life" not in toml.read_text(encoding="utf-8")
    assert not any(a.startswith("add conventions") for a in report.actions)


def test_migrate_2_to_3_without_a_conventions_folder_creates_only_the_index(v2):
    shutil.rmtree(v2 / "conventions")
    report = migrate(v2, to=3, today=TODAY)
    assert sorted(p.name for p in (v2 / "conventions").iterdir()) == ["index.md"]
    assert report.actions[0] == "create conventions/index.md"


def test_migrate_1_to_3_is_cumulative(tmp_path):
    root = tmp_path / "kotiaivot-v1"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot-v1", root)
    (root / "gitignore").rename(root / ".gitignore")
    report = migrate(root, to=3, today=TODAY)
    assert "stamp brainpick.toml: format 1 → 2" in report.actions
    assert "stamp brainpick.toml: format 2 → 3" in report.actions
    toml = (root / "brainpick.toml").read_text(encoding="utf-8")
    assert "format = 3" in toml and "conventions = 0" in toml  # 1→2 wrote the table, 2→3 completed it
    assert (root / "conventions" / "index.md").is_file()


def test_migrate_2_to_3_is_idempotent(v2):
    migrate(v2, to=3, today=TODAY)
    before = {p: p.read_text(encoding="utf-8") for p in v2.rglob("*.md")}
    assert migrate(v2, to=3, today=TODAY).actions == []
    assert {p: p.read_text(encoding="utf-8") for p in v2.rglob("*.md")} == before
