---
type: Reference
title: MCP tools
description: The six MCP tools brainpick exposes — overview, search, read, neighbors, write, show — designed so a 27B model guesses right on the first try.
timestamp: 2026-07-08T00:00:00Z
---

# MCP tools

Brainpick serves agents over MCP in three transports: stdio (`brainpick
mcp`, what the init snippets configure), streamable HTTP at `/mcp`, and
legacy SSE at `/sse`. Both engines define the same six tools verbatim; the
contract lives in the spec, not in either implementation.

The ergonomics are small-model-first: at most one required argument, obvious
names, forgiving enums (an unknown mode falls back to `auto` with a note),
token budgets on every call, and every result ending with a one-line hint of
what to call next.

1. **`brain_overview()`** — orientation: bundle name, document/tag/entity
   counts, tier availability, the top-level index tree with one-sentence
   descriptions, and usage hints. The progressive-disclosure root.
2. **`brain_search({query, mode?, limit?, budget_tokens?})`** — returns
   titles and descriptions only, never full documents, each hit annotated
   with *why* it matched. Modes are described in
   [search modes](search-modes.md).
3. **`brain_read({doc, sections?, budget_tokens?})`** — forgiving
   resolution (path, id, or fuzzy title), body or requested sections, and an
   outline-first answer when the note exceeds the budget.
4. **`brain_neighbors({doc, depth?, layer?})`** — adjacency with
   descriptions, on the explicit-link layer, the entity layer of the
   [knowledge graph tier](knowledge-graph-tier.md), or both.
5. **`brain_write({doc, content, mode})`** — the one write path, guarded by
   the henxels contract; see [guarded writes](guarded-writes.md).
6. **`brain_show({nodes?, focus?, mode?, annotation?, clear?})`** — agent-driven
   [presentations](presentations.md): spotlight a subgraph, fly the camera to
   it, and caption it live in every open UI. Every argument is optional, and it
   is ephemeral and advisory — it never writes the brain.

Two resources complement the tools: `brain://index` (the generated index) and
`brain://doc/{path}`. Progressive disclosure mirrors OKF's own philosophy:
descriptions first, hydration on demand — an agent never pays for content it
did not ask for, and never maintains any of it by hand.
