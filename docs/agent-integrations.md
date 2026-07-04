---
type: Reference
title: Agent integrations
description: How brainpick meets agents where they live — a shipped Agent Skill, one-command integrations for each harness, four CLI query mirrors, and an AGENTS.md brain report that teaches graph-before-grep.
timestamp: 2026-07-04T07:30:00Z
---

# Agent integrations

Compiling a brain is only half the job; the other half is making sure agents
actually *use* it. Brainpick ships an **Agent Skill**, one-command **integrations**
for the common harnesses, terminal **query mirrors** of the [MCP tools](mcp-tools.md),
and an opt-in **brain report** it writes into your `AGENTS.md` — so the first
instinct becomes *ask the brain*, not *grep the files*.

## Graph-before-grep

A compiled brain knows titles, descriptions, links, and neighbors; raw grep knows
only strings. The whole integration layer exists to install one habit: **consult
the brain before grepping or answering.** Start with `brain_overview`, narrow with
[search](search-modes.md), open with `brain_read`, and walk `brain_neighbors` —
grep is the fallback when the brain comes up short.

## The Agent Skill

One canonical [Anthropic Agent Skill](https://agentskills.io) rides inside both
engines. It teaches a small model, in short imperatives: when to consult the brain,
the five MCP tools with one-line examples, their CLI equivalents, the guarded-write
conventions, and the bearer-token etiquette. `brainpick integrate` drops it where a
harness will read it, and a parity test keeps every shipped copy byte-identical to
the source of truth.

## The `integrate` command

`brainpick integrate <target>` wires brainpick into a harness — additively, never
editing settings for you:

- **`claude-code`** writes the skill to `.claude/skills/brainpick/SKILL.md`, then
  prints a paste-able graph-before-grep `PreToolUse` hook and the `claude mcp add`
  snippet.
- **`opencode`** writes the skill under `.opencode/skills/` and prints the
  `opencode.json` MCP server snippet.
- **`agents-md`** ensures an `AGENTS.md` exists (the one place integrate may create a
  file), installs the report markers, and compiles so the block fills.

Every target takes `--dry-run` to preview without writing, and detects the repo root
so the skill lands beside the code, not inside the bundle. It reuses the same MCP
snippets [onboarding](onboarding.md) hands out.

## The CLI query mirrors

The four read tools are also plain CLI verbs — the same router and state the MCP
tools and REST serve, with no server running:

```bash
brainpick overview
brainpick search "vuorovesi" --mode auto --limit 8
brainpick read kuu
brainpick neighbors kuu --depth 2
```

Add `--json` for the raw MCP payload a machine would get. When the brain is not
compiled yet, a mirror prints a compile instruction instead of crashing; a stale
brain still answers and notes that a recompile is due. (Writes stay on the
[guarded](guarded-writes.md) MCP path — the mirrors are read-only.)

## The AGENTS.md brain report

When an `AGENTS.md` carries the markers
`<!-- brainpick:begin report … -->` / `<!-- brainpick:end report -->`, every compile
refreshes the block between them — same hash-stamped fence mechanics as the generated
index. The report is deterministic and byte-identical across engines: a
graph-before-grep directive, the counts, the tier status, the top hub documents by
total degree, the orphans, and the bundle root. Compile only *refreshes* an existing
block; it never creates the file, and unmarked `AGENTS.md` files are never touched.
