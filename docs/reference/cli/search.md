---
type: reference
about: thing
title: "brainpick search"
description: "Search the compiled brain from the terminal — the brain_search tool as a CLI verb, with --mode, --limit and --json."
tags: [cli, spec]
timestamp: 2026-07-10T18:30:00Z
---

# brainpick search

`brainpick search QUERY [--root DIR]` runs `brain_search` in the terminal,
against the compiled brain, read-only (it never compiles). It returns titles
and descriptions with a match reason — never full bodies.

## Flags

- `--mode MODE` — `auto | keyword | semantic | graph` (default `auto`; an unknown value falls back to `auto`).
- `--limit N` — max hits (default `8`).
- `--json` — print the raw MCP payload as JSON.

Modes and their honest degradation are [search modes](../../search-modes.md);
the tool is [brain_search](../mcp/brain-search.md). If the brain is not compiled
the mirror prints a compile instruction; a stale brain still answers and notes a
recompile is due. Back to [CLI reference](../../reference-cli.md).
