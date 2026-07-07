---
type: Reference
title: "brain_neighbors"
description: "Adjacency around a doc — depth 1–3, on the link layer, the entity layer, or both — with entities degrading to links until T3."
timestamp: 2026-07-08T00:00:00Z
---

# brain_neighbors

`brain_neighbors({doc, depth?, layer?, budget_tokens?})` returns the `center`,
`nodes` (`{path, title, description, distance}`) and `edges` (`{source,
target, kind}`), plus a `hint`. `depth` is 1–3 (default 1); `layer ∈
links|entities|both` (default `links`), where `entities` degrades to `links`
with `degraded_from` until T3. Default budget 800.

The entity layer reads the [knowledge graph tier](../../knowledge-graph-tier.md);
its CLI mirror is [brainpick neighbors](../cli/neighbors.md). Back to [MCP tool reference](../../reference-mcp.md).
