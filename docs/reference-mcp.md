---
type: Reference
title: "MCP tool reference"
description: "The six MCP tools brainpick exposes — overview, search, read, neighbors, write, show — one page each, with their arguments, returns and small-model ergonomics."
timestamp: 2026-07-08T00:00:00Z
---

# MCP tool reference

Both engines expose the same six MCP tools, verbatim, over stdio, streamable
HTTP (`/mcp`) and legacy SSE (`/sse`). The design is small-model-first: at most
one required argument, forgiving enums, a `budget_tokens` on every call, and
every result ending in a `hint` naming a sensible next call. Each page below
documents one tool; the concept is [MCP tools](mcp-tools.md).

## The read tools

- [brain_overview](reference/mcp/brain-overview.md) — orientation: counts, tiers, the index tree.
- [brain_search](reference/mcp/brain-search.md) — titles and descriptions with a match reason.
- [brain_read](reference/mcp/brain-read.md) — one doc, forgivingly resolved, budget-shaped.
- [brain_neighbors](reference/mcp/brain-neighbors.md) — adjacency on links, entities, or both.

## Write and present

- [brain_write](reference/mcp/brain-write.md) — the one guarded write path.
- [brain_show](reference/mcp/brain-show.md) — spotlight a subgraph live in every UI.

The same tools are mirrored as CLI verbs in the [CLI reference](reference-cli.md).
Back to [Reference](reference.md).
