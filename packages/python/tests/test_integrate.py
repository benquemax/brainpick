"""`brainpick integrate` (skill, MCP snippets, the AGENTS.md report) and the
compile-side report fill. The shipped skill must match the repo-root canonical."""
import json
import shutil

import pytest

from brainpick.compile.pipeline import run_compile
from brainpick.compile.t1 import REPORT_BEGIN_PREFIX, REPORT_END_MARKER
from brainpick.integrate import (
    SKILL_DESTINATIONS,
    exported_skill_stubs,
    render_skill_stub,
    run_integrate,
    skill_path,
    skill_text,
)

from conftest import FIXTURE_BUNDLES, REPO_ROOT

CANONICAL = REPO_ROOT / "integrations" / "skill" / "SKILL.md"


@pytest.fixture
def repo(tmp_path):
    """A git repo whose bundle is the kotiaurinko fixture in a subdirectory."""
    (tmp_path / ".git").mkdir()
    bundle = tmp_path / "wiki"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", bundle)
    return tmp_path, bundle


# -- the Agent Skill: one canonical copy, byte-identical shipped copy --------------


def test_skill_parity_shipped_equals_canonical():
    assert skill_path().read_text(encoding="utf-8") == CANONICAL.read_text(encoding="utf-8")
    text = skill_text()
    assert text.startswith("---\nname: brainpick\n")  # Anthropic agent-skills front matter
    assert "description:" in text.split("---", 2)[1]


# -- integrate claude-code / opencode ---------------------------------------------


def test_integrate_claude_code_writes_skill_and_prints_snippets(repo, capsys):
    root, bundle = repo
    assert run_integrate("claude-code", bundle) == 0
    skill = root / SKILL_DESTINATIONS["claude-code"]
    assert skill.read_text(encoding="utf-8") == CANONICAL.read_text(encoding="utf-8")
    out = capsys.readouterr().out
    assert "PreToolUse" in out and "Grep|Glob" in out  # graph-before-grep hook
    assert "claude mcp add brainpick" in out            # reused snippet builder


def test_integrate_opencode_writes_skill_under_its_convention(repo, capsys):
    root, bundle = repo
    assert run_integrate("opencode", bundle) == 0
    skill = root / SKILL_DESTINATIONS["opencode"]
    assert skill.read_text(encoding="utf-8") == CANONICAL.read_text(encoding="utf-8")
    assert "opencode" in capsys.readouterr().out.lower()


def test_integrate_dsh_writes_skill_and_prints_cordis_insert(repo, capsys):
    root, bundle = repo
    assert run_integrate("dsh", bundle) == 0
    skill = root / SKILL_DESTINATIONS["dsh"]
    assert skill.read_text(encoding="utf-8") == CANONICAL.read_text(encoding="utf-8")
    out = capsys.readouterr().out
    assert "@deepseek-ai/dsh-mcp-client" in out       # the mcp-client bundle
    assert "cordis.patch.yml" in out                   # where the row goes
    assert "serverName: brainpick" in out
    # The root rides inside a JSON args row, so assert it as the snippet encodes
    # it — on Windows the raw path and its JSON form differ by every backslash.
    assert json.dumps(str(bundle)) in out              # resolved absolute root, not a stale path
    assert "claude mcp add" not in out                 # dsh has no such command


def test_integrate_dry_run_is_inert(repo, capsys):
    root, bundle = repo
    assert run_integrate("claude-code", bundle, dry_run=True) == 0
    assert not (root / ".claude").exists()
    assert run_integrate("dsh", bundle, dry_run=True) == 0
    assert not (root / ".claude").exists()
    assert run_integrate("agents-md", bundle, dry_run=True) == 0
    assert not (root / "AGENTS.md").exists()


# -- integrate agents-md: create, mark, compile, fill -----------------------------


def test_integrate_agents_md_creates_markers_and_fills_the_block(repo):
    root, bundle = repo
    assert run_integrate("agents-md", bundle) == 0
    text = (root / "AGENTS.md").read_text(encoding="utf-8")
    assert REPORT_BEGIN_PREFIX in text and REPORT_END_MARKER in text
    assert "Consult the brain BEFORE grepping" in text
    assert "- Counts: 10 docs · 20 links · 8 tags · 1 orphans · 1 ghosts" in text
    assert "Bundle root: wiki" in text  # the bundle is a subdir of the repo


def test_integrate_agents_md_places_report_above_henxels(repo):
    root, bundle = repo
    agents = root / "AGENTS.md"
    agents.write_text(
        "# AGENTS.md\n\nIntro.\n\n<!-- henxels:begin -->\ncontract\n<!-- henxels:end -->\n",
        encoding="utf-8",
    )
    run_integrate("agents-md", bundle)
    text = agents.read_text(encoding="utf-8")
    assert text.index(REPORT_BEGIN_PREFIX) < text.index("<!-- henxels:begin -->")
    assert "Intro." in text and "contract" in text


# -- the compile-side fill (spec/20 mechanics) ------------------------------------


def test_compile_fills_a_marked_repo_agents_md(repo):
    root, bundle = repo
    agents = root / "AGENTS.md"
    agents.write_text(
        f"top matter\n\n{REPORT_BEGIN_PREFIX}old) -->\nplaceholder\n{REPORT_END_MARKER}\nbottom matter\n",
        encoding="utf-8",
    )
    run_compile(bundle)
    text = agents.read_text(encoding="utf-8")
    assert "placeholder" not in text
    assert "- Counts: 10 docs" in text
    assert text.startswith("top matter\n")
    assert text.rstrip().endswith("bottom matter")


def test_compile_never_creates_agents_md(repo):
    root, bundle = repo
    run_compile(bundle)
    assert not (root / "AGENTS.md").exists()
    assert not (bundle / "AGENTS.md").exists()


def test_compile_report_fill_is_idempotent(repo):
    root, bundle = repo
    agents = root / "AGENTS.md"
    agents.write_text(f"x\n\n{REPORT_BEGIN_PREFIX}p) -->\n_\n{REPORT_END_MARKER}\n", encoding="utf-8")
    run_compile(bundle)
    first = agents.read_bytes()
    run_compile(bundle)
    assert agents.read_bytes() == first  # a second compile rewrites nothing


# -- exported skills: pointer stubs beside the brainpick skill (spec/85) ---------


@pytest.fixture
def brain_repo(tmp_path):
    """A git repo whose bundle is the kotiaivot brain (one skill exports itself)."""
    (tmp_path / ".git").mkdir()
    bundle = tmp_path / "brain"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaivot", bundle)
    return tmp_path, bundle


def test_skill_stub_is_a_pointer_not_a_copy():
    stub = render_skill_stub({
        "depends_on": ["skills/veden-keitto.md"], "description": "Use when brewing.",
        "export": ["agent-skill"], "path": "skills/kahvin-keitto.md", "title": "Kahvin keitto",
        "tools": ["tools/keita"],
    })
    assert stub.startswith("---\nname: kahvin-keitto\ndescription: Use when brewing.\n---\n")
    assert "# Kahvin keitto" in stub
    assert "`brain_read skills/kahvin-keitto.md`" in stub
    assert "- Prerequisites: skills/veden-keitto.md" in stub
    assert "- Tools: tools/keita" in stub
    bare = render_skill_stub({"depends_on": [], "description": None, "export": ["agent-skill"],
                              "path": "skills/x.md", "title": "X", "tools": []})
    assert "description: X\n" in bare and "- Prerequisites: none" in bare and "- Tools: none" in bare


def test_exported_skill_stubs_come_from_skills_json_in_path_order(brain_repo):
    root, bundle = brain_repo
    run_compile(bundle)
    stubs = exported_skill_stubs(bundle)
    assert [s["path"] for s in stubs] == ["skills/kahvin-keitto.md"]  # veden-keitto has no export


@pytest.mark.parametrize("target", ["claude-code", "opencode", "dsh"])
def test_integrate_writes_a_stub_per_exported_skill(brain_repo, target, capsys):
    root, bundle = brain_repo
    run_compile(bundle)
    assert run_integrate(target, bundle) == 0
    skills_dir = (root / SKILL_DESTINATIONS[target]).parent.parent
    stub = skills_dir / "kahvin-keitto" / "SKILL.md"
    assert stub.is_file()
    assert "This skill lives in the brain at `skills/kahvin-keitto.md`" in stub.read_text(encoding="utf-8")
    assert not (skills_dir / "veden-keitto").exists()
    assert "exported skill" in capsys.readouterr().out


def test_integrate_skips_a_stub_that_would_shadow_brainpick(brain_repo, capsys):
    root, bundle = brain_repo
    (bundle / "skills" / "brainpick.md").write_text(
        "---\ntype: skill\ntitle: Brainpick\nexport: agent-skill\n---\n# Brainpick\n\n"
        "[Kahvin keitto](kahvin-keitto.md)\n", encoding="utf-8")
    run_compile(bundle)
    assert run_integrate("claude-code", bundle) == 0
    skill = root / SKILL_DESTINATIONS["claude-code"]
    assert skill.read_text(encoding="utf-8") == CANONICAL.read_text(encoding="utf-8")
    assert "shadow" in capsys.readouterr().out


def test_integrate_dry_run_names_the_stubs_without_writing(brain_repo, capsys):
    root, bundle = brain_repo
    run_compile(bundle)
    assert run_integrate("claude-code", bundle, dry_run=True) == 0
    assert not (root / ".claude").exists()
    assert "kahvin-keitto" in capsys.readouterr().out
