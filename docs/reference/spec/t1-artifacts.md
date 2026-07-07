---
type: Reference
title: "Spec: T1 artifacts"
description: "The deterministic heart — document scanning, link extraction, graph.json (nodes, edges, ghosts, islands, orphans, tags), docs.jsonl, and the generated index."
timestamp: 2026-07-08T00:00:00Z
---

# Spec: T1 artifacts

T1 is fully deterministic — no model calls, no randomness. This spec fixes
**document scanning** (title/type/description/timestamp/tags resolution, with
PyYAML-compatible 1.1 frontmatter tolerance), **link extraction** (markdown and
wikilinks, rooted vs relative resolution; an unresolved link is a *ghost*), and
the normative artifacts:

- `t1/graph.json` — nodes (with `in`/`out` degree and `orphan`), edges, ghosts, islands, tags, and stats.
- `t1/docs.jsonl` — one line per document, the substrate for keyword search and reading.
- the generated `index.md` block — grouped by directory, entries sorted by title, hash-stamped.

An **orphan** is a non-reserved node with zero inbound edges from non-reserved
nodes; **islands** are the non-mainland connected components. This is the
concrete form of the [artifact spec](../../artifact-spec.md) and the T1 rung of
[the tiers](../../the-tiers.md); the opt-in AGENTS.md brain report shares the
same fence mechanics as [agent integrations](../../agent-integrations.md).
Back to [Spec reference](../../reference-spec.md).
