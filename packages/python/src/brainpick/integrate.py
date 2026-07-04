"""`brainpick integrate <target>`: meet agents where they live.

Three targets, one family voice (mirrors henxels' `integrate`):

- `claude-code`  — write the Agent Skill into the repo, then PRINT a paste-able
  graph-before-grep PreToolUse hook and the `claude mcp add` snippet (settings.json
  is never edited for you).
- `opencode`     — write the skill under OpenCode's convention, then PRINT the
  opencode.json MCP snippet.
- `agents-md`    — ensure an AGENTS.md exists (the one place integrate may create a
  file), install the brain-report markers if absent, and compile so the block fills.

The shipped Agent Skill (integrations/skill/SKILL.md, canonical) rides inside the
package; the parity test asserts the shipped copy is byte-identical to the canonical.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from brainpick.compile.pipeline import run_compile
from brainpick.compile.t1 import REPORT_BEGIN_PREFIX, REPORT_END_MARKER
from brainpick.detect import find_repo_root
from brainpick.scaffold import _Voice, mcp_snippets

TARGETS = ("claude-code", "opencode", "agents-md")
HENXELS_BEGIN = "<!-- henxels:begin -->"

# harness -> where its Agent Skill lands, relative to the repo root
SKILL_DESTINATIONS = {
    "claude-code": Path(".claude") / "skills" / "brainpick" / "SKILL.md",
    "opencode": Path(".opencode") / "skills" / "brainpick" / "SKILL.md",
}

_MINIMAL_AGENTS = "# AGENTS.md\n\nWorking notes for agents in this repository.\n"
_REPORT_PLACEHOLDER = (
    f"{REPORT_BEGIN_PREFIX}pending) -->\n"
    "_brainpick fills this block on the next `brainpick compile`._\n"
    f"{REPORT_END_MARKER}"
)


def skill_path() -> Path:
    """The shipped Agent Skill: the package copy first (installed wheels), then
    the repo-root canonical (dev checkout)."""
    packaged = Path(__file__).resolve().parent / "_skill" / "SKILL.md"
    if packaged.is_file():
        return packaged
    return Path(__file__).resolve().parents[4] / "integrations" / "skill" / "SKILL.md"


def skill_text() -> str:
    return skill_path().read_text(encoding="utf-8")


def _graph_before_grep_hook() -> str:
    """A paste-able Claude Code PreToolUse fragment that nudges the agent toward
    the brain before it greps — advisory (exit 0), never a block."""
    fragment = {
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "Grep|Glob",
                    "hooks": [
                        {
                            "type": "command",
                            "command": (
                                "echo 'brainpick: consult the brain first — brain_search "
                                "or `brainpick search` before grepping' >&2"
                            ),
                        }
                    ],
                }
            ]
        }
    }
    return json.dumps(fragment, indent=2)


def _write_skill(repo: Path, target: str, dry_run: bool) -> tuple[Path, bool]:
    dest = repo / SKILL_DESTINATIONS[target]
    existed = dest.is_file()
    if not dry_run:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(skill_text(), encoding="utf-8")
    return dest, existed


def _insert_report_markers(text: str) -> str:
    """Install the report markers above the henxels digest block when one exists,
    else at the end — never disturbing hand-written content."""
    if REPORT_BEGIN_PREFIX in text:
        return text
    idx = text.find(HENXELS_BEGIN)
    if idx != -1:
        return text[:idx].rstrip("\n") + "\n\n" + _REPORT_PLACEHOLDER + "\n\n" + text[idx:]
    return text.rstrip("\n") + "\n\n" + _REPORT_PLACEHOLDER + "\n"


def _integrate_claude_code(voice: _Voice, root: Path, repo: Path, dry_run: bool) -> int:
    dest, existed = _write_skill(repo, "claude-code", dry_run)
    verb = "would write" if dry_run else ("updated" if existed else "wrote")
    voice.line("✓", f"skill: {verb} {dest}")
    if dry_run:
        voice.step("• print the graph-before-grep PreToolUse hook and the `claude mcp add` snippet")
        return 0
    voice.raw()
    voice.raw("Paste into .claude/settings.json (settings are never edited for you):")
    voice.raw()
    voice.raw(_graph_before_grep_hook())
    voice.raw()
    voice.raw(mcp_snippets(root))
    return 0


def _integrate_opencode(voice: _Voice, root: Path, repo: Path, dry_run: bool) -> int:
    dest, existed = _write_skill(repo, "opencode", dry_run)
    verb = "would write" if dry_run else ("updated" if existed else "wrote")
    voice.line("✓", f"skill: {verb} {dest}")
    if dry_run:
        voice.step("• print the opencode.json MCP snippet")
        return 0
    voice.raw()
    voice.raw("Add the MCP server to opencode.json (merging JSON is left to you):")
    voice.raw()
    voice.raw(mcp_snippets(root))
    return 0


def _integrate_agents_md(voice: _Voice, root: Path, repo: Path, dry_run: bool) -> int:
    agents = repo / "AGENTS.md"
    existed = agents.is_file()
    has_markers = existed and REPORT_BEGIN_PREFIX in agents.read_text(encoding="utf-8")

    if dry_run:
        if not existed:
            voice.step(f"• create a minimal {agents}")
        if not has_markers:
            voice.step(f"• install the brain-report markers in {agents}")
        voice.step(f"• compile {root} so the report block fills")
        return 0

    text = agents.read_text(encoding="utf-8") if existed else _MINIMAL_AGENTS
    if not existed:
        voice.line("✓", f"AGENTS.md: created {agents}")
    if REPORT_BEGIN_PREFIX not in text:
        text = _insert_report_markers(text)
        voice.line("✓", f"report: markers installed in {agents}")
    else:
        voice.line("○", f"report: markers already in {agents}")
    agents.write_text(text, encoding="utf-8")

    result = run_compile(root)
    voice.line("✓", f"compiled: the report block is filled (seq {result.seq})")
    voice.step(f"read it back: sed -n '/brainpick:begin report/,/brainpick:end report/p' {agents}")
    return 0


def run_integrate(target: str, root: str | Path, dry_run: bool = False) -> int:
    if target not in TARGETS:
        print(f"unknown target {target!r}; choose from {', '.join(TARGETS)}")
        return 1
    voice = _Voice(os.environ)
    voice.banner()
    root = Path(root).resolve()
    if not root.is_dir():
        voice.line("✗", f"{root} is not a directory")
        return 1
    repo = find_repo_root(root) or root
    voice.line("○", f"repo root: {repo}" + ("" if repo != root else " (the bundle is its own repo)"))
    if dry_run:
        voice.raw()
        voice.raw(f"dry run — nothing written. integrate {target} would:")

    if target == "claude-code":
        return _integrate_claude_code(voice, root, repo, dry_run)
    if target == "opencode":
        return _integrate_opencode(voice, root, repo, dry_run)
    return _integrate_agents_md(voice, root, repo, dry_run)
