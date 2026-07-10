---
type: article
about: concept
title: Search modes
description: One search tool, four strategies — keyword, semantic, graph, and auto-fusion — with honest reporting when a tier is unavailable.
tags: [tier, graph]
timestamp: 2026-07-10T18:30:00Z
---

# Search modes

Brainpick deliberately ships one search surface with a `mode` switch instead
of a tool per strategy — fewer tools with obvious names is what makes small
models reliable (see [MCP tools](mcp-tools.md)).

- **keyword** — BM25 over the T1 document substrate. Runs in-memory in both
  engines and depends on nothing beyond a compiled T1, so search works even
  on an installation with no vector extras at all.
- **semantic** — vector similarity over embedded chunks, available when T2
  is compiled (see [embedding detection](embedding-detection.md)).
- **graph** — entity-aware retrieval over the
  [knowledge graph tier](knowledge-graph-tier.md); when T3 is off, it
  degrades to a walk of the T1 link graph combined with keyword hits.
- **auto** — the default: every available retriever runs and results fuse
  via reciprocal rank fusion, deduplicated by document.

Honesty is part of the contract: responses carry which modes actually
answered and a `degraded_from` marker when the requested strategy was
unavailable — the agent (and the UI) always know whether they got semantic
recall or a keyword fallback. Degradation follows [the tiers](the-tiers.md):
a missing model downgrades the answer, never errors the call.

Every result is budget-shaped: descriptions survive first, snippets are
trimmed next, and a truncated response says exactly how to get the rest.
