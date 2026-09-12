"""`brainpick skill new|list` (spec/85 *Skills*): scaffold a compliant, empty skill
whose body carries the evaluate-and-improve loop, and list the skills a compiled
brain holds. Brainpick ships no skills of its own — a skill is something an agent
distils from its own repetition; this only makes the first draft cost one call."""
from __future__ import annotations

import posixpath
import re
from datetime import datetime, timezone
from pathlib import Path

_TEMPLATE = """\
# {title}

## Trigger

<!-- When does this skill apply? The description above is what search and the
overview show — make it start with "Use when …" so an agent recognises the
moment. -->

## Steps

1. {first_step}

## Tools

<!-- The deterministic parts, demoted to scripts listed in `tools:` above.
Say what each one does and how to run it; brainpick never runs them for you. -->
{tools_section}
## Gotchas

<!-- What went wrong last time and how the steps now avoid it. -->

## When not to use this

<!-- The boundary: the neighbouring situation where a different skill (or no
skill) is right. -->

## Evaluation log

<!-- After every use: did the steps hold? What was manual that should be a
tool? Improve the steps, bump `timestamp`, add a dated line here. -->

- {date}: created.

## Related
{related_section}"""


def kebab(name: str) -> str:
    """A skill name -> its kebab-case file stem (the wiki convention)."""
    stem = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return stem or "skill"


def _yaml_list(values: list[str]) -> str:
    return "[" + ", ".join(values) + "]"


def _yaml_str(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def skills_dir(root: Path, existing: list[dict]) -> str:
    """Beside the existing skills (the first by path); `skills/` by convention
    when there are none yet — the template's folder, never the engine's test."""
    if existing:
        return posixpath.dirname(existing[0]["path"])
    return "skills"


def render_skill(
    title: str, description: str, depends_on: list[str], tools: list[str],
    titles: dict[str, str], own_dir: str, now: datetime | None = None,
) -> str:
    """The whole file: OKF frontmatter (`type: skill`, a real timestamp) plus the
    template body, with each prerequisite linked so the new page is not an orphan."""
    now = now or datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "---",
        "type: skill",
        f"title: {_yaml_str(title)}",
        f"description: {_yaml_str(description)}",
        f"timestamp: {stamp}",
        f"depends_on: {_yaml_list(depends_on)}",
    ]
    if tools:
        lines.append(f"tools: {_yaml_list(tools)}")
    lines.append("---")
    lines.append("")

    related = ""
    for dep in depends_on:
        rel = posixpath.relpath(dep, own_dir or ".")
        related += f"\n- needs [{titles.get(dep, dep)}]({rel})"
    if not related:
        related = "\n<!-- Links to the concepts this skill grounds on and the skills near it. -->"
    tools_section = "".join(f"\n- `{t}` — <!-- what it does -->" for t in tools)
    if tools_section:
        tools_section += "\n"
    first_step = "<!-- the first concrete action -->"
    if depends_on:
        first_step = "First, " + " and ".join(
            f"[{titles.get(d, d)}]({posixpath.relpath(d, own_dir or '.')})" for d in depends_on) + "."
    body = _TEMPLATE.format(
        title=title, first_step=first_step, tools_section=tools_section,
        date=now.strftime("%Y-%m-%d"), related_section=related + "\n",
    )
    return "\n".join(lines) + "\n" + body


def present_skills(skills: list[dict]) -> str:
    if not skills:
        return "no skills — `brainpick skill new <name>` scaffolds the first one"
    lines = [f"{len(skills)} skills"]
    for skill in skills:
        desc = f" — {skill['description']}" if skill.get("description") else ""
        lines.append(f"  {skill['path']}  {skill['title']}{desc}")
        if skill["depends_on"]:
            lines.append("    needs: " + ", ".join(skill["depends_on"]))
        if skill["tools"]:
            lines.append("    tools: " + ", ".join(skill["tools"]))
    return "\n".join(lines)
