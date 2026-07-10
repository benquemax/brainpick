---
type: reference
about: thing
title: "brainpick integrate"
description: "Install brainpick into an agent harness — the skill, an MCP snippet and the brain report — additively, with --dry-run."
tags: [cli, spec]
timestamp: 2026-07-10T18:30:00Z
---

# brainpick integrate

`brainpick integrate TARGET [--root DIR]` wires brainpick into an agent harness
additively — it never edits your settings for you. `TARGET` is one of:

- `claude-code` — writes the skill to `.claude/skills/brainpick/SKILL.md`, then prints a graph-before-grep `PreToolUse` hook and the `claude mcp add` snippet.
- `opencode` — writes the skill under `.opencode/skills/` and prints the `opencode.json` MCP server snippet.
- `agents-md` — ensures an `AGENTS.md` exists (the one file integrate may create), installs the report markers, and compiles so the block fills.

Add `--dry-run` to preview without writing. This is the machinery of
[agent integrations](../../agent-integrations.md); the report it installs is
refreshed by the [compile pipeline](../../compile-pipeline.md). Back to [CLI reference](../../reference-cli.md).
