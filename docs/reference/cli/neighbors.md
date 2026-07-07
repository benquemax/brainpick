---
type: Reference
title: "brainpick neighbors"
description: "Walk the link graph around a doc — the brain_neighbors tool as a CLI verb, with --depth and --layer."
timestamp: 2026-07-08T00:00:00Z
---

# brainpick neighbors

`brainpick neighbors DOC [--root DIR]` walks the graph around a document.
`DOC` resolves like [brainpick read](read.md) (path, stem, or title).

## Flags

- `--depth N` — hops to walk, 1–3 (default `1`).
- `--layer LAYER` — `links | entities | both` (default `links`; `entities` degrades to `links` until T3).
- `--json` — print the raw MCP payload as JSON.

The `entities` layer reads the [knowledge graph tier](../../knowledge-graph-tier.md);
the tool is [brain_neighbors](../mcp/brain-neighbors.md). Back to [CLI reference](../../reference-cli.md).
