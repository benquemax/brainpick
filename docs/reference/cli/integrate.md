---
type: reference
about: thing
title: "brainpick integrate"
description: "Install brainpick into an agent harness — the skill, an MCP snippet, the brain report and the brain ritual — additively, with --dry-run."
tags: [cli, spec]
timestamp: 2026-09-13T14:00:00Z
---

# brainpick integrate

`brainpick integrate TARGET [--root DIR]` wires brainpick into an agent harness
additively — it never edits your settings for you. `TARGET` is one of:

- `claude-code` — writes the skill to `.claude/skills/brainpick/SKILL.md`, then prints a graph-before-grep `PreToolUse` hook and the `claude mcp add` snippet.
- `opencode` — writes the skill under `.opencode/skills/` and prints the `opencode.json` MCP server snippet.
- `agents-md` — ensures an `AGENTS.md` exists (the one file integrate may create), installs the report markers, and compiles so the block fills.
- `dsh` — writes the skill under the `.claude/skills` convention dsh shares and prints the `cordis.patch.yml` insert.

Every target also installs [the brain ritual](../../brain-ritual.md) — a static
`brainpick:begin ritual (v1)` block directly below the report: pull and
compile first, consult before grepping, record while working, commit and
push last. `agents-md` creates the file for it; the harness targets install it
only into an `AGENTS.md` that exists, and an older block is replaced in place.

Add `--dry-run` to preview without writing. This is the machinery of
[agent integrations](../../agent-integrations.md); the report it installs is
refreshed by the [compile pipeline](../../compile-pipeline.md). Back to [CLI reference](../../reference-cli.md).
