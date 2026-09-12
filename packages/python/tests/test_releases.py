"""The release ledger and the what's-new notice (spec/80 *The release ledger*):
agents never read changelogs — the brain tells them what changed since it was
last compiled and what to do about it. The notice's rules are pinned by the
whats-new conformance class; these tests cover the ledger's shape, the shipped
copy's parity, the CLI and where the notice surfaces."""
from __future__ import annotations

import json
import shutil

import pytest
import yaml

from brainpick import __version__
from brainpick.cli import main
from brainpick.compile.pipeline import run_compile
from brainpick.compile.t1 import render_report_block
from brainpick.releases import (
    latest_brain_format,
    ledger_path,
    load_ledger,
    render_whats_new,
)

from conftest import FIXTURE_BUNDLES, SPEC

CANONICAL = SPEC / "releases.yaml"
FIXTURE_LEDGER = SPEC / "fixtures" / "releases" / "ledger.yaml"


# -- the ledger --------------------------------------------------------------------

def test_shipped_ledger_is_byte_identical_to_the_canonical():
    assert ledger_path().read_text(encoding="utf-8") == CANONICAL.read_text(encoding="utf-8")


def test_canonical_ledger_is_well_formed_newest_first_and_heads_at_the_package_version():
    ledger = load_ledger()
    assert ledger, "an empty ledger says nothing"
    versions = [r["version"] for r in ledger]
    assert versions == sorted(versions, key=lambda v: tuple(int(x) for x in v.split(".")), reverse=True)
    head = ledger[0]
    if head["date"] == "unreleased":
        assert tuple(int(x) for x in head["version"].split(".")) > tuple(int(x) for x in __version__.split("."))
    else:
        assert head["version"] == __version__
    for release in ledger:
        assert set(release) >= {"version", "date", "brain_format", "summary", "changes"}
        assert isinstance(release["brain_format"], int)
        for change in release["changes"]:
            assert change["kind"] in {"added", "changed", "fixed", "removed"}
            assert change["area"] in {"brain", "cli", "mcp", "search", "config", "compile", "webui", "docs"}
            assert change["text"].strip()
    # every released tag is in the ledger — the ledger is the history agents see
    assert "0.5.0" in versions and "0.1.0" in versions


def test_latest_brain_format_counts_the_unreleased_head_but_not_released_futures():
    ledger = load_ledger(FIXTURE_LEDGER)
    assert latest_brain_format(ledger, "1.1.1") == 3  # the unreleased head is what this checkout writes
    assert latest_brain_format(ledger, "1.2.0") == 3
    released_only = [r for r in ledger if r["date"] != "unreleased"]
    assert latest_brain_format(released_only, "1.0.0") == 1  # 1.1.0's format 2 is a future release
    assert latest_brain_format(released_only, "0.9.0") is None


# -- render: what `brainpick whats-new` prints --------------------------------------

def test_render_collects_agent_actions_under_do_next():
    ledger = load_ledger(FIXTURE_LEDGER)
    text = render_whats_new(ledger, current="1.1.1", since="1.0.0", brain_format=1)
    assert "## 1.1.1 (2026-09-20)" in text and "## 1.1.0 (2026-09-13)" in text
    assert "## 1.0.0" not in text and "## 1.2.0" not in text  # since is exclusive; the head is unreleased
    assert "- added (brain): Brain format 2." in text
    assert "Do next:" in text
    # a numbered checklist in the order to do them: oldest shown release first,
    # each in ledger order, the format part last
    do_next = text[text.index("Do next:"):]
    assert do_next == (
        "Do next:\n\n"
        "1. Run `brainpick migrate --to 2`.\n"
        "2. Run `brainpick integrate agents-md`.\n"
        "3. brain format 1 → 3: run `brainpick migrate --to 3`\n"  # the head's format
    )


def test_render_with_nothing_between_shows_the_current_release_itself():
    ledger = load_ledger(FIXTURE_LEDGER)
    text = render_whats_new(ledger, current="1.1.1", since=None, brain_format=None)
    assert text.startswith("## 1.1.1 (2026-09-20)")
    assert "## 1.1.0" not in text


# -- the CLI --------------------------------------------------------------------------

@pytest.fixture
def brain_v1(tmp_path):
    root = tmp_path / "kotiaivot-v1"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot-v1", root)
    return root


def test_cli_whats_new_defaults_to_the_manifest_generator_and_names_the_format(brain_v1, capsys, monkeypatch):
    run_compile(brain_v1)
    manifest = json.loads((brain_v1 / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))
    manifest["generator"]["version"] = "0.4.0"
    (brain_v1 / ".brainpick" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    assert main(["whats-new", "--root", str(brain_v1)]) == 0
    out = capsys.readouterr().out
    assert "## 0.5.0 (2026-09-11)" in out and "## 0.4.5" in out and "## 0.4.0" not in out
    assert "brain format 1 → 2: run `brainpick migrate --to 2`" in out


def test_cli_whats_new_since_all_and_json(brain_v1, capsys):
    assert main(["whats-new", "--root", str(brain_v1), "--since", "0.4.4"]) == 0
    out = capsys.readouterr().out
    assert "## 0.4.5" in out and "## 0.4.4" not in out
    assert main(["whats-new", "--root", str(brain_v1), "--all"]) == 0
    out = capsys.readouterr().out
    assert "## 0.1.0 (2026-08-25)" in out
    assert main(["whats-new", "--root", str(brain_v1), "--since", "0.4.4", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert [r["version"] for r in payload["releases"]][-1] == "0.4.5"
    assert payload["notice"]["format"] == {"current": 1, "latest": 2}
    assert payload["notice"]["since"] == "0.4.4"


def test_cli_whats_new_outside_a_brain_prints_the_current_release(tmp_path, capsys):
    wiki = tmp_path / "wiki"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", wiki)
    assert main(["whats-new", "--root", str(wiki)]) == 0
    out = capsys.readouterr().out
    assert out.startswith("## ") and "brain format" not in out


# -- where the notice surfaces ---------------------------------------------------------

def test_compile_result_and_report_carry_the_notice_for_an_old_brain(brain_v1, capsys):
    agents = brain_v1 / "AGENTS.md"
    agents.write_text("# A\n\n<!-- brainpick:begin report (hash:0) -->\n<!-- brainpick:end report -->\n",
                      encoding="utf-8")
    result = run_compile(brain_v1)
    assert result.whats_new is not None
    assert result.whats_new["format"] == {"current": 1, "latest": 2}
    assert "releases" not in result.whats_new  # a first compile has no `since`
    text = agents.read_text(encoding="utf-8")
    assert "- What's new: brain format 1 → 2: run `brainpick migrate --to 2`" in text
    assert text.index("- Bundle root:") < text.index("- What's new:")
    main(["compile", "--root", str(brain_v1)])
    assert "note: what's new — brain format 1 → 2" in capsys.readouterr().out


def test_release_part_clears_once_the_current_version_has_compiled(brain_v1):
    run_compile(brain_v1)
    bp = brain_v1 / ".brainpick"
    manifest = json.loads((bp / "manifest.json").read_text(encoding="utf-8"))
    manifest["generator"]["version"] = "0.1.0"
    (bp / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (brain_v1 / "knowledge" / "vieraat.md").write_text(
        (brain_v1 / "knowledge" / "vieraat.md").read_text(encoding="utf-8") + "\nMore.\n", encoding="utf-8")
    result = run_compile(brain_v1)
    assert result.whats_new["since"] == "0.1.0" and "0.5.0" in result.whats_new["releases"]
    assert "run `brainpick whats-new --since 0.1.0`" in result.whats_new["hint"]
    # the manifest was rewritten by the current version: the release part is gone, the format part stays
    again = run_compile(brain_v1)
    assert "releases" not in again.whats_new and again.whats_new["format"]["current"] == 1


def test_format_2_brain_compiled_by_this_version_hears_nothing(tmp_path):
    root = tmp_path / "kotiaivot"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot", root)
    run_compile(root)
    assert run_compile(root).whats_new is None


def test_report_block_stays_golden_without_a_notice(tmp_path):
    root = tmp_path / "kotiaivot"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot", root)
    run_compile(root)
    bp = root / ".brainpick"
    graph = json.loads((bp / "t1" / "graph.json").read_text(encoding="utf-8"))
    skills = json.loads((bp / "t1" / "skills.json").read_text(encoding="utf-8"))
    tiers = {"t1": "fresh", "t2": "off", "t3": "off"}
    plain = render_report_block(graph, tiers, ".", None, skills)
    noticed = render_report_block(graph, tiers, ".", None, skills, None,
                                  {"current": "9.9.9", "format": {"current": 1, "latest": 2}, "hint": "x"})
    strip = lambda block: block.split("\n", 1)[1]  # noqa: E731 — the hash stamp line differs by design
    assert strip(noticed).replace("\n- What's new: x", "") == strip(plain)
    assert noticed.index("- Bundle root:") < noticed.index("- What's new: x")


def test_overview_carries_whats_new_and_leads_the_hint(brain_v1):
    from brainpick.config import load_config
    from brainpick.mcp_server import overview_payload
    from brainpick.serve.state import ServeState

    state = ServeState(brain_v1, load_config(brain_v1))
    state.load()
    result = overview_payload(state)
    assert result["whats_new"]["format"] == {"current": 1, "latest": 2}
    assert result["hint"].startswith("What's new — brain format 1 → 2: run `brainpick migrate --to 2`. ")


def test_fixture_ledger_matches_the_canonical_shape():
    for path in (CANONICAL, FIXTURE_LEDGER):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        assert list(data) == ["releases"]
