"""Skills (spec/85 *Skills*, spec/20 *Skills and frontmatter edges*): procedural
memory the engine recognises by `type`, links by `depends_on`, points at by
`tools`, surfaces first — and never executes."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from brainpick.cli import main
from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.compile.skills import (
    SKILLTREE_FILE,
    build_skills,
    dependency_cycles,
    is_skill,
    render_skilltree,
)
from brainpick.compile.t1 import build_docs_records, build_graph, render_report_block
from brainpick.core.bundle import scan
from brainpick.mcp_server import overview_payload, read_payload, search_payload
from brainpick.query.keyword import search
from brainpick.serve.state import ServeState
from brainpick.config import load_config

from conftest import FIXTURE_BUNDLES


@pytest.fixture
def kotiaivot(tmp_path: Path) -> Path:
    dst = tmp_path / "kotiaivot"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot", dst)
    return dst


def _state(root: Path) -> ServeState:
    run_compile(root)
    state = ServeState(root, load_config(root))
    state.reload_artifacts()
    return state


# -- recognition ------------------------------------------------------------------


@pytest.mark.parametrize("value,expected", [
    ("skill", True), ("Skill", True), ("SKILL ", True),
    ("playbook", False), ("Playbook", False),  # a how-to for humans, not procedural memory
    ("Concept", False), ("reference", False), (None, False), ("", False),
])
def test_is_skill_is_keyed_on_type_case_insensitively(value, expected):
    assert is_skill(value) is expected


def test_a_playbook_is_never_a_skill(kotiaivot):
    """The fixture's host how-to (type: playbook) reaches neither skills.json nor the tree."""
    docs = scan(kotiaivot, exclude=["raw/*"])
    root = kotiaivot
    assert "knowledge/vieraat.md" in {d.path for d in docs}
    skills = build_skills(docs, root)
    assert [s["path"] for s in skills["skills"]] == ["skills/kahvin-keitto.md", "skills/veden-keitto.md"]
    assert "vieraat" not in render_skilltree(skills, "skills/" + SKILLTREE_FILE)


def test_reserved_files_are_never_skills(tmp_path):
    (tmp_path / "skills").mkdir()
    (tmp_path / "skills" / "index.md").write_text("---\ntype: skill\n---\n# no\n", encoding="utf-8")
    (tmp_path / "skills" / "skilltree.md").write_text("---\ntype: skill\n---\n# no\n", encoding="utf-8")
    (tmp_path / "skills" / "a.md").write_text("---\ntype: skill\n---\n# A\n", encoding="utf-8")
    docs = scan(tmp_path)
    assert [d.path for d in docs if d.skill] == ["skills/a.md"]
    assert next(d for d in docs if d.path == "skills/skilltree.md").reserved is True


# -- T1: depends_on edges, tools, skills.json -------------------------------------


def test_depends_on_becomes_an_authored_edge(kotiaivot):
    graph = build_graph(scan(kotiaivot, exclude=("raw/*",)))
    dep = [e for e in graph["edges"] if e["kind"] == "depends_on"]
    assert dep == [{
        "count": 1, "kind": "depends_on", "label": "Veden keitto",
        "source": "skills/kahvin-keitto.md", "target": "skills/veden-keitto.md",
    }]
    nodes = {n["id"]: n for n in graph["nodes"]}
    # the body link AND the depends_on edge both land: two distinct kinds, two edges
    assert nodes["skills/veden-keitto.md"]["in"] >= 2
    assert nodes["skills/veden-keitto.md"]["orphan"] is False


def test_unresolved_depends_on_is_a_ghost_and_self_dependency_is_dropped(tmp_path):
    (tmp_path / "a.md").write_text(
        "---\ntype: skill\ntitle: A\ndepends_on: [a.md, missing.md]\n---\n# A\n\n[B](b.md)\n",
        encoding="utf-8")
    (tmp_path / "b.md").write_text("---\ntype: Concept\ntitle: B\n---\n# B\n\n[A](a.md)\n", encoding="utf-8")
    graph = build_graph(scan(tmp_path))
    assert graph["ghosts"] == [{"source": "a.md", "target": "missing.md"}]
    assert not [e for e in graph["edges"] if e["kind"] == "depends_on"]


def test_depends_on_resolves_rooted_then_relative_and_wraps_scalars(tmp_path):
    (tmp_path / "skills").mkdir()
    (tmp_path / "skills" / "a.md").write_text(
        "---\ntype: skill\ntitle: A\ndepends_on: b\n---\n# A\n\n[B](b.md)\n", encoding="utf-8")
    (tmp_path / "skills" / "b.md").write_text(
        "---\ntype: skill\ntitle: B\ndepends_on: [/skills/c]\n---\n# B\n\n[C](c.md)\n", encoding="utf-8")
    (tmp_path / "skills" / "c.md").write_text("---\ntype: skill\ntitle: C\n---\n# C\n\n[A](a.md)\n", encoding="utf-8")
    skills = build_skills(scan(tmp_path), tmp_path)["skills"]
    by_path = {s["path"]: s for s in skills}
    assert by_path["skills/a.md"]["depends_on"] == ["skills/b.md"]   # relative to the skill's dir
    assert by_path["skills/b.md"]["depends_on"] == ["skills/c.md"]   # rooted
    assert by_path["skills/c.md"]["depends_on"] == []


def test_depends_on_and_tools_are_ignored_on_non_skills(tmp_path):
    (tmp_path / "a.md").write_text(
        "---\ntype: Concept\ntitle: A\ndepends_on: [b.md]\ntools: [x]\n---\n# A\n\n[B](b.md)\n",
        encoding="utf-8")
    (tmp_path / "b.md").write_text("---\ntitle: B\n---\n# B\n\n[A](a.md)\n", encoding="utf-8")
    docs = scan(tmp_path)
    graph = build_graph(docs)
    assert not [e for e in graph["edges"] if e["kind"] == "depends_on"]
    assert build_skills(docs, tmp_path) == {"skills": []}


def test_skills_json_lists_resolved_prerequisites_and_tools(kotiaivot):
    skills = build_skills(scan(kotiaivot, exclude=("raw/*",)), kotiaivot)
    assert skills == {"skills": [
        {"depends_on": ["skills/veden-keitto.md"],
         "description": "Use when brewing the morning coffee — the whole procedure, kettle to cup.",
         "path": "skills/kahvin-keitto.md", "title": "Kahvin keitto", "tools": ["tools/keita"]},
        {"depends_on": [],
         "description": "Use when you need boiling water — for coffee, tea, or pasta.",
         "path": "skills/veden-keitto.md", "title": "Veden keitto", "tools": []},
    ]}


def test_tools_resolve_relative_to_the_skill_and_survive_when_missing(tmp_path):
    (tmp_path / "skills").mkdir()
    (tmp_path / "tools").mkdir()
    (tmp_path / "tools" / "go").write_text("#!/bin/sh\n", encoding="utf-8")
    (tmp_path / "skills" / "a.md").write_text(
        "---\ntype: skill\ntitle: A\ntools: [../tools/go, tools/nope]\n---\n# A\n\n[B](b.md)\n",
        encoding="utf-8")
    (tmp_path / "skills" / "b.md").write_text("---\ntitle: B\n---\n# B\n\n[A](a.md)\n", encoding="utf-8")
    skills = build_skills(scan(tmp_path), tmp_path)["skills"]
    assert skills[0]["tools"] == ["tools/go", "tools/nope"]  # resolved; kept as declared


def test_compile_writes_skills_json_and_it_gates_freshness(kotiaivot):
    run_compile(kotiaivot)
    artifact = kotiaivot / ".brainpick" / "t1" / "skills.json"
    assert json.loads(artifact.read_text(encoding="utf-8"))["skills"][0]["path"] == "skills/kahvin-keitto.md"
    assert check_fresh(kotiaivot).fresh
    artifact.write_text('{"skills": []}\n', encoding="utf-8")
    assert not check_fresh(kotiaivot).fresh


def test_wiki_without_skills_still_writes_an_empty_skills_json(kotiaurinko):
    run_compile(kotiaurinko)
    assert json.loads((kotiaurinko / ".brainpick" / "t1" / "skills.json").read_text()) == {"skills": []}


# -- skilltree.md -----------------------------------------------------------------


def test_skilltree_renders_every_skill_once_with_needs_and_tools(kotiaivot):
    docs = scan(kotiaivot, exclude=("raw/*",))
    text = render_skilltree(build_skills(docs, kotiaivot), "skills/" + SKILLTREE_FILE)
    assert text == (
        "# Skill tree\n\n"
        "_Generated by `brainpick compile` from `depends_on` frontmatter — edit the\n"
        "skills, never this file._\n\n"
        "- [Kahvin keitto](kahvin-keitto.md) — Use when brewing the morning coffee — the whole procedure, kettle to cup.\n"
        "  - needs [Veden keitto](veden-keitto.md)\n"
        "  - tools: `../tools/keita`\n"
        "- [Veden keitto](veden-keitto.md) — Use when you need boiling water — for coffee, tea, or pasta.\n"
    )


def test_compile_generates_skilltree_in_a_brain_and_never_in_a_wiki(kotiaivot, kotiaurinko):
    run_compile(kotiaivot)
    tree = kotiaivot / "skills" / SKILLTREE_FILE
    assert tree.is_file()
    manifest = json.loads((kotiaivot / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))
    assert "skills/skilltree.md" in manifest["files"]           # written before the artifact scan
    assert "raw/kuitti.md" not in manifest["files"]
    assert "skilltree" not in (kotiaivot / "index.md").read_text(encoding="utf-8")  # reserved: unlisted
    assert check_fresh(kotiaivot).fresh
    tree.write_text("# stale\n", encoding="utf-8")
    assert not check_fresh(kotiaivot).fresh                     # a hand edit is drift

    (kotiaurinko / "kuu.md").write_text(
        "---\ntype: skill\ntitle: Kuu\n---\n# Kuu\n\n[Maa](maa.md)\n", encoding="utf-8")
    run_compile(kotiaurinko)                                    # a wiki: no [brain] section
    assert not list(kotiaurinko.rglob(SKILLTREE_FILE))


def test_dependency_cycle_is_a_warning_not_a_failure(tmp_path):
    (tmp_path / "brainpick.toml").write_text("[brain]\nformat = 1\n", encoding="utf-8")
    (tmp_path / "a.md").write_text(
        "---\ntype: skill\ntitle: A\ndepends_on: [b.md]\n---\n# A\n\n[B](b.md)\n", encoding="utf-8")
    (tmp_path / "b.md").write_text(
        "---\ntype: skill\ntitle: B\ndepends_on: [a.md]\n---\n# B\n\n[A](a.md)\n", encoding="utf-8")
    skills = build_skills(scan(tmp_path), tmp_path)
    assert dependency_cycles(skills) == [["a.md", "b.md"]]
    result = run_compile(tmp_path)
    assert any("cycle" in w and "a.md" in w for w in result.warnings)
    assert (tmp_path / SKILLTREE_FILE).read_text(encoding="utf-8").count("\n- [") == 2


# -- report block -----------------------------------------------------------------


def test_report_lists_skills_only_when_there_are_any(kotiaivot, kotiaurinko):
    docs = scan(kotiaivot, exclude=("raw/*",))
    block = render_report_block(build_graph(docs), {"t1": "fresh"}, skills=build_skills(docs, kotiaivot))
    assert "- Skills (read before improvising):\n" in block
    assert ("  - Kahvin keitto (skills/kahvin-keitto.md) — Use when brewing the morning coffee"
            " — the whole procedure, kettle to cup.\n    · tools: tools/keita\n") in block
    assert block.index("- Skills") < block.index("- Bundle root")

    wiki = scan(kotiaurinko)
    assert "Skills" not in render_report_block(build_graph(wiki), {"t1": "fresh"}, skills=build_skills(wiki, kotiaurinko))


# -- search ------------------------------------------------------------------------


def test_keyword_search_boosts_a_matching_skill_above_prose(kotiaivot):
    records = build_docs_records(scan(kotiaivot, exclude=("raw/*",)))
    hits = search(records, "morning coffee", limit=8)  # raw BM25 ranks the prose page first
    assert [h["path"] for h in hits][:2] == ["skills/kahvin-keitto.md", "knowledge/kahvi.md"]


def test_skill_boost_never_surfaces_a_skill_the_query_missed(kotiaivot):
    records = build_docs_records(scan(kotiaivot, exclude=("raw/*",)))
    assert [h["path"] for h in search(records, "click", limit=8)] == ["skills/veden-keitto.md"]


# -- overview / read payloads ------------------------------------------------------


def test_overview_lists_skills_apart_from_the_tree(kotiaivot):
    result = overview_payload(_state(kotiaivot))
    assert result["skills"] == [
        {"path": "skills/kahvin-keitto.md", "title": "Kahvin keitto",
         "description": "Use when brewing the morning coffee — the whole procedure, kettle to cup.",
         "depends_on": ["skills/veden-keitto.md"], "tools": ["tools/keita"]},
        {"path": "skills/veden-keitto.md", "title": "Veden keitto",
         "description": "Use when you need boiling water — for coffee, tea, or pasta.",
         "depends_on": [], "tools": []},
    ]
    assert "skill" in result["hint"].lower()
    assert not any(d["path"].endswith("skilltree.md") for g in result["tree"] for d in g["docs"])


def test_overview_skills_survive_budget_trimming(kotiaivot):
    result = overview_payload(_state(kotiaivot), budget_tokens=150)
    assert result["truncated"] is True
    assert len(result["skills"]) == 2


def test_overview_without_skills_has_an_empty_list(kotiaurinko):
    result = overview_payload(_state(kotiaurinko))
    assert result["skills"] == []
    assert "skill" not in result["hint"].lower()


def test_read_on_a_skill_returns_prerequisites_dependents_and_tools(kotiaivot):
    state = _state(kotiaivot)
    result = read_payload(state, "kahvin-keitto")
    assert result["skill"] == {
        "depends_on": [{"path": "skills/veden-keitto.md", "title": "Veden keitto"}],
        "dependents": [],
        "tools": [{"path": "tools/keita", "exists": True}],
    }
    assert "tools/keita" in result["hint"] and "never" in result["hint"]
    dep = read_payload(state, "veden-keitto")
    assert dep["skill"]["dependents"] == [{"path": "skills/kahvin-keitto.md", "title": "Kahvin keitto"}]
    assert "skill" not in read_payload(state, "kahvi")


def test_search_payload_reports_why_for_a_boosted_skill(kotiaivot):
    result = search_payload(_state(kotiaivot), "morning coffee", mode="keyword")
    assert result["hits"][0]["path"] == "skills/kahvin-keitto.md"


# -- CLI: brainpick skill list / new ------------------------------------------------


def test_cli_skill_list_plain_and_json(kotiaivot, capsys):
    main(["compile", "--root", str(kotiaivot)])
    capsys.readouterr()
    assert main(["skill", "list", "--root", str(kotiaivot)]) == 0
    out = capsys.readouterr().out
    assert "skills/kahvin-keitto.md" in out and "Use when brewing" in out and "needs" in out
    assert main(["skill", "list", "--root", str(kotiaivot), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["skills"][1]["path"] == "skills/veden-keitto.md"


def test_cli_skill_list_selfheals_when_uncompiled(kotiaivot, capsys):
    assert main(["skill", "list", "--root", str(kotiaivot)]) == 0
    assert "compile" in capsys.readouterr().err


def test_cli_skill_new_scaffolds_a_compliant_doc_and_compiles(kotiaivot, capsys):
    main(["compile", "--root", str(kotiaivot)])
    assert main(["skill", "new", "Tee Batch Upscale", "--root", str(kotiaivot),
                 "--description", "Use when a folder of images needs upscaling in one go.",
                 "--depends-on", "skills/veden-keitto.md", "--tool", "tools/keita"]) == 0
    path = kotiaivot / "skills" / "tee-batch-upscale.md"
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\ntype: skill\ntitle: \"Tee Batch Upscale\"\n")
    assert 'description: "Use when a folder of images needs upscaling in one go."' in text
    assert "timestamp: 20" in text and text.count("Z\n") >= 1
    assert "depends_on: [skills/veden-keitto.md]" in text
    assert "tools: [tools/keita]" in text
    for heading in ("## Trigger", "## Steps", "## Tools", "## Gotchas", "## When not to use this",
                    "## Evaluation log", "## Related"):
        assert heading in text
    assert "[Veden keitto](veden-keitto.md)" in text            # linked, not an orphan
    assert check_fresh(kotiaivot).fresh                          # compiled after writing
    skills = json.loads((kotiaivot / ".brainpick" / "t1" / "skills.json").read_text(encoding="utf-8"))
    assert "skills/tee-batch-upscale.md" in [s["path"] for s in skills["skills"]]
    assert "skills/tee-batch-upscale.md" in capsys.readouterr().out


def test_cli_skill_new_refuses_to_overwrite(kotiaivot, capsys):
    assert main(["skill", "new", "kahvin-keitto", "--root", str(kotiaivot)]) == 1
    assert "exists" in capsys.readouterr().err


def test_cli_skill_new_picks_the_skills_dir_or_the_root(kotiaurinko, kotiaivot, capsys):
    assert main(["skill", "new", "first", "--root", str(kotiaurinko)]) == 0
    assert (kotiaurinko / "skills" / "first.md").is_file()      # no skills yet: skills/ by convention
    assert main(["skill", "new", "second", "--root", str(kotiaivot)]) == 0
    assert (kotiaivot / "skills" / "second.md").is_file()       # beside the existing skills
