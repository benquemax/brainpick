"""`brainpick integrate <target>`: meet agents where they live.

Three targets, one family voice (mirrors henxels' `integrate`):

- `claude-code`  — write the Agent Skill into the repo, then PRINT a paste-able
  graph-before-grep PreToolUse hook and the `claude mcp add` snippet (settings.json
  is never edited for you).
- `opencode`     — write the skill under OpenCode's convention, then PRINT the
  opencode.json MCP snippet.
- `agents-md`    — ensure an AGENTS.md exists (the one place integrate may create a
  file), install the brain-report markers if absent, and compile so the block fills.

Every target also installs the brain ritual block (spec/20) into AGENTS.md when
one exists — pull and compile first, consult before grepping, record while
working, commit and push last — directly below the report block; `agents-md`
creates the file so the ritual always lands.
- `dsh`          — write the Agent Skill (the `.claude/skills` convention dsh shares),
  then PRINT the `cordis.patch.yml` insert that mounts brainpick through
  `@deepseek-ai/dsh-mcp-client` (dsh has no `claude mcp add`; a server is a config row).

The shipped Agent Skill (integrations/skill/SKILL.md, canonical) and the ritual
(integrations/ritual/RITUAL.md) ride inside the package; parity tests assert the
shipped copies are byte-identical to the canonicals.
"""
from __future__ import annotations

import json
import os
import posixpath
import re
from pathlib import Path

from brainpick.compile.pipeline import run_compile
from brainpick.compile.t1 import REPORT_BEGIN_PREFIX, REPORT_END_MARKER
from brainpick.detect import find_repo_root
from brainpick.scaffold import _Voice, dsh_snippet, mcp_snippets

TARGETS = ("claude-code", "opencode", "agents-md", "dsh")
HENXELS_BEGIN = "<!-- henxels:begin -->"

# harness -> where its Agent Skill lands, relative to the repo root
SKILL_DESTINATIONS = {
    "claude-code": Path(".claude") / "skills" / "brainpick" / "SKILL.md",
    "opencode": Path(".opencode") / "skills" / "brainpick" / "SKILL.md",
    # dsh loads Agent Skills from the same .claude/skills convention as Claude Code.
    "dsh": Path(".claude") / "skills" / "brainpick" / "SKILL.md",
}

_MINIMAL_AGENTS = "# AGENTS.md\n\nWorking notes for agents in this repository.\n"

# The brain ritual block (spec/20 *The brain ritual block*): static text, versioned
# by the canonical itself, installed by every integrate target, never generated.
RITUAL_VERSION = 1
RITUAL_BEGIN_PREFIX = "<!-- brainpick:begin ritual (v"
RITUAL_END_MARKER = "<!-- brainpick:end ritual -->"
_RITUAL_BLOCK = re.compile(
    re.escape(RITUAL_BEGIN_PREFIX) + r"(\d+)\) -->\n.*?" + re.escape(RITUAL_END_MARKER),
    re.S,
)
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


def ritual_path() -> Path:
    """The shipped ritual text: the package copy first, then the repo-root canonical."""
    packaged = Path(__file__).resolve().parent / "_ritual" / "RITUAL.md"
    if packaged.is_file():
        return packaged
    return Path(__file__).resolve().parents[4] / "integrations" / "ritual" / "RITUAL.md"


def render_ritual_block() -> str:
    """The fenced block exactly as it lands in AGENTS.md (conformance class `ritual`)."""
    body = ritual_path().read_text(encoding="utf-8").strip("\n")
    return f"{RITUAL_BEGIN_PREFIX}{RITUAL_VERSION}) -->\n{body}\n{RITUAL_END_MARKER}\n"


def ritual_version_in(text: str) -> int | None:
    """The version of the ritual block `text` carries, or None when it has none."""
    m = _RITUAL_BLOCK.search(text)
    return int(m.group(1)) if m else None


def install_ritual(text: str) -> str:
    """Install (or refresh) the ritual block: directly below the report block when
    there is one, else where the report would go (above henxels, else at the end).
    An older version is replaced in place; the current one is left untouched."""
    block = render_ritual_block().rstrip("\n")
    m = _RITUAL_BLOCK.search(text)
    if m:
        if int(m.group(1)) >= RITUAL_VERSION:
            return text
        return text[: m.start()] + block + text[m.end():]
    end = text.find(REPORT_END_MARKER)
    if end != -1:
        after = end + len(REPORT_END_MARKER)
        rest = text[after:]
        return text[:after] + "\n\n" + block + ("\n" + rest if rest.strip("\n") else "\n")
    idx = text.find(HENXELS_BEGIN)
    if idx != -1:
        return text[:idx].rstrip("\n") + "\n\n" + block + "\n\n" + text[idx:]
    return text.rstrip("\n") + "\n\n" + block + "\n"


def _install_ritual_into(voice: _Voice, repo: Path, dry_run: bool, create: bool) -> str | None:
    """Apply the ritual to the repo's AGENTS.md; returns the text to write (None when
    nothing is to be written). Harness targets never create the file — `agents-md` does."""
    agents = repo / "AGENTS.md"
    if not agents.is_file():
        if not create:
            voice.line("○", f"ritual: no AGENTS.md at {repo} — run `brainpick integrate agents-md` to create one")
            return None
        text = _MINIMAL_AGENTS
    else:
        text = agents.read_text(encoding="utf-8")
    have = ritual_version_in(text)
    if dry_run:
        if have is None:
            voice.step(f"• install the brain ritual block (v{RITUAL_VERSION}) in {agents}")
        elif have < RITUAL_VERSION:
            voice.step(f"• refresh the brain ritual block v{have} → v{RITUAL_VERSION} in {agents}")
        return None
    out = install_ritual(text)
    if have is None:
        voice.line("✓", f"ritual: installed (v{RITUAL_VERSION}) in {agents} — pull first, push last")
    elif have < RITUAL_VERSION:
        voice.line("✓", f"ritual: refreshed v{have} → v{RITUAL_VERSION} in {agents}")
    else:
        voice.line("○", f"ritual: already current (v{RITUAL_VERSION}) in {agents}")
    return out


def _ritual_for_harness(voice: _Voice, repo: Path, dry_run: bool) -> None:
    out = _install_ritual_into(voice, repo, dry_run, create=False)
    if out is not None:
        (repo / "AGENTS.md").write_text(out, encoding="utf-8")


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


_STUB_TEMPLATE = """---
name: {name}
description: {description}
---

# {title}

This skill lives in the brain at `{path}`. Read it there before acting —
`brain_read {path}` (MCP) or `brainpick read {path}` (CLI) — the brain
copy is canonical and carries its prerequisites and tools.

- Prerequisites: {prerequisites}
- Tools: {tools}
"""


def render_skill_stub(skill: dict) -> str:
    """The pointer stub for one exported skill (spec/85 *Exported skills*): the
    harness loads it on its trigger, the brain stays canonical."""
    name = posixpath.splitext(posixpath.basename(skill["path"]))[0]
    description = (skill.get("description") or skill["title"]).replace("\n", " ").strip()
    return _STUB_TEMPLATE.format(
        name=name, description=description, title=skill["title"], path=skill["path"],
        prerequisites=", ".join(skill.get("depends_on") or []) or "none",
        tools=", ".join(skill.get("tools") or []) or "none",
    )


def exported_skill_stubs(root: Path) -> list[dict]:
    """The skills that declare `export: agent-skill`, from the compiled
    t1/skills.json (path order) — empty when the bundle is uncompiled or a wiki."""
    artifact = Path(root) / ".brainpick" / "t1" / "skills.json"
    try:
        data = json.loads(artifact.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [s for s in data.get("skills", []) if "agent-skill" in (s.get("export") or [])]


def _write_stubs(voice: _Voice, root: Path, repo: Path, target: str, dry_run: bool) -> None:
    skills_dir = (repo / SKILL_DESTINATIONS[target]).parent.parent
    for skill in exported_skill_stubs(root):
        name = posixpath.splitext(posixpath.basename(skill["path"]))[0]
        if name == "brainpick":
            voice.line("!", f"exported skill {skill['path']} skipped — its stub would shadow "
                            "the brainpick skill; rename the doc")
            continue
        dest = skills_dir / name / "SKILL.md"
        if dry_run:
            voice.step(f"• write the exported skill stub {dest}")
            continue
        existed = dest.is_file()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(render_skill_stub(skill), encoding="utf-8")
        voice.line("✓", f"exported skill: {'updated' if existed else 'wrote'} {dest} → {skill['path']}")


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
    _write_stubs(voice, root, repo, "claude-code", dry_run)
    _ritual_for_harness(voice, repo, dry_run)
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
    _write_stubs(voice, root, repo, "opencode", dry_run)
    _ritual_for_harness(voice, repo, dry_run)
    if dry_run:
        voice.step("• print the opencode.json MCP snippet")
        return 0
    voice.raw()
    voice.raw("Add the MCP server to opencode.json (merging JSON is left to you):")
    voice.raw()
    voice.raw(mcp_snippets(root))
    return 0


def _integrate_dsh(voice: _Voice, root: Path, repo: Path, dry_run: bool) -> int:
    dest, existed = _write_skill(repo, "dsh", dry_run)
    verb = "would write" if dry_run else ("updated" if existed else "wrote")
    voice.line("✓", f"skill: {verb} {dest}")
    _write_stubs(voice, root, repo, "dsh", dry_run)
    _ritual_for_harness(voice, repo, dry_run)
    if dry_run:
        voice.step("• print the cordis.patch.yml insert for @deepseek-ai/dsh-mcp-client")
        return 0
    voice.raw()
    voice.raw(dsh_snippet(root))
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
        _install_ritual_into(voice, repo, dry_run=True, create=True)
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
    ritual = _install_ritual_into(voice, repo, dry_run=False, create=True)
    if ritual is not None:
        agents.write_text(ritual, encoding="utf-8")

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
    if target == "dsh":
        return _integrate_dsh(voice, root, repo, dry_run)
    return _integrate_agents_md(voice, root, repo, dry_run)
