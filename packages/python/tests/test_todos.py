"""To-do lists (spec/85 *To-do lists*, spec/20 *t1/todos.json*): a `type: todo`
doc's checklist lines are items the engine indexes, counts in the overview and
marks on search hits — so "is anything about X still open?" is one
brain_search away instead of a grep. The engine never edits a list."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from brainpick.cli import main
from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.compile.todos import build_todos, is_todo, parse_todo_items
from brainpick.config import load_config
from brainpick.core.bundle import scan
from brainpick.mcp_server import overview_payload, search_payload
from brainpick.serve.state import ServeState


def _state(root: Path) -> ServeState:
    run_compile(root)
    state = ServeState(root, load_config(root))
    state.reload_artifacts()
    return state


# -- recognition ------------------------------------------------------------------


@pytest.mark.parametrize("value,expected", [
    ("todo", True), ("Todo", True), ("TODO ", True),
    ("skill", False), ("log", False), (None, False), ("", False),
])
def test_is_todo_is_keyed_on_type_case_insensitively(value, expected):
    assert is_todo(value) is expected


def test_scan_flags_todo_docs_and_never_reserved_files(tmp_path):
    (tmp_path / "a.md").write_text("---\ntype: todo\ntitle: A\n---\n# A\n\n- [ ] x\n", encoding="utf-8")
    (tmp_path / "index.md").write_text("---\nokf_version: '0.1'\n---\n# I\n\n- [ ] not an item\n",
                                       encoding="utf-8")
    docs = {d.path: d for d in scan(tmp_path)}
    assert docs["a.md"].todo is True
    assert docs["index.md"].todo is False


# -- items ------------------------------------------------------------------------


def test_parse_todo_items_reads_checklist_lines_only():
    text = (
        "---\ntype: todo\ntimestamp: 2026-07-02T08:00:00Z\n---\n"
        "# Open\n\n"
        "- [ ] Descale the kettle\n"
        "* [x] Buy filters (done: 2026-07-01)\n"
        "  + [X] Nested and upper-case\n"
        "- plain bullet, not an item\n"
        "- [] malformed, not an item\n"
        "```\n- [ ] inside a fence, skipped\n```\n"
        "- [x] Dated by the doc\n"
    )
    items = parse_todo_items(text, "2026-07-02T08:00:00Z")
    assert items == [
        {"done": None, "line": 7, "status": "open", "text": "Descale the kettle"},
        {"done": "2026-07-01", "line": 8, "status": "done", "text": "Buy filters"},
        {"done": "2026-07-02", "line": 9, "status": "done", "text": "Nested and upper-case"},
        {"done": "2026-07-02", "line": 15, "status": "done", "text": "Dated by the doc"},
    ]


def test_parse_todo_items_without_timestamp_leaves_done_null():
    assert parse_todo_items("- [x] a\n", None) == [{"done": None, "line": 1, "status": "done", "text": "a"}]


def test_build_todos_is_sorted_by_path_then_line(kotiaivot):
    todos = build_todos(scan(kotiaivot, exclude=("raw/*",)), kotiaivot)
    assert todos == {"todos": [
        {"done": "2026-07-01", "line": 10, "path": "todo/archive/2026-07-01.md", "status": "done",
         "text": "Write down the [Kahvin keitto](../../skills/kahvin-keitto.md) procedure"},
        {"done": None, "line": 10, "path": "todo/open.md", "status": "open",
         "text": "Descale the kettle — see [Veden keitto](../skills/veden-keitto.md)"},
        {"done": None, "line": 11, "path": "todo/open.md", "status": "open",
         "text": "Try the oily beans again once `keita` retries twice"},
        {"done": "2026-07-02", "line": 12, "path": "todo/open.md", "status": "done", "text": "Buy filters"},
    ]}


def test_compile_writes_todos_json_and_it_gates_freshness(kotiaivot):
    run_compile(kotiaivot)
    artifact = kotiaivot / ".brainpick" / "t1" / "todos.json"
    assert json.loads(artifact.read_text(encoding="utf-8"))["todos"][1]["text"].startswith("Descale")
    assert check_fresh(kotiaivot).fresh
    artifact.write_text('{"todos": []}', encoding="utf-8")
    assert not check_fresh(kotiaivot).fresh


def test_a_wiki_without_lists_writes_an_empty_artifact(kotiaurinko):
    run_compile(kotiaurinko)
    artifact = kotiaurinko / ".brainpick" / "t1" / "todos.json"
    assert json.loads(artifact.read_text(encoding="utf-8")) == {"todos": []}


# -- surfaces ---------------------------------------------------------------------


def test_overview_counts_todos_and_points_at_the_open_list(kotiaivot):
    result = overview_payload(_state(kotiaivot))
    assert result["todos"] == {"open": 2, "done": 2}
    assert "2 open todos" in result["hint"]
    assert "todo/open.md" in result["hint"]


def test_overview_without_lists_reports_zero_and_says_nothing(kotiaurinko):
    result = overview_payload(_state(kotiaurinko))
    assert result["todos"] == {"open": 0, "done": 0}
    assert "todo" not in result["hint"]


def test_overview_reads_a_stale_artifact_as_no_todos(kotiaivot):
    run_compile(kotiaivot)
    (kotiaivot / ".brainpick" / "t1" / "todos.json").unlink()
    state = ServeState(kotiaivot, load_config(kotiaivot))
    state.reload_artifacts()
    assert overview_payload(state)["todos"] == {"open": 0, "done": 0}


def test_search_hit_on_a_todo_list_carries_its_counts(kotiaivot):
    result = search_payload(_state(kotiaivot), "descale", mode="keyword")
    hit = result["hits"][0]
    assert hit["path"] == "todo/open.md"
    assert hit["todo"] == {"open": 2, "done": 1}
    other = search_payload(_state(kotiaivot), "vesi", mode="keyword")["hits"][0]
    assert "todo" not in other


def test_cli_overview_prints_the_todo_line(kotiaivot, capsys):
    run_compile(kotiaivot)
    assert main(["overview", "--root", str(kotiaivot)]) == 0
    assert "todos: 2 open · 2 done" in capsys.readouterr().out
