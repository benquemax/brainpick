---
type: article
about: concept
title: The tiers
description: Brainpick's four-tier retrieval ladder, where every tier is optional except the files and each degrades gracefully to the one below.
tags: [tier]
timestamp: 2026-07-10T18:30:00Z
---

# The tiers

Brainpick organizes everything it can do with a brain into four tiers. The
files themselves are the only mandatory layer; every tier above them is an
optional upgrade that can be switched off — or simply be unavailable — without
breaking anything below it.

| Tier | What | Needs |
|------|------|-------|
| T0 | grep/glob over the files | nothing |
| T1 | generated `index.md`, link graph, backlinks, tags | nothing (deterministic) |
| T2 | vector search over chunks | an embedding model |
| T3 | entity/relation graph | nothing; an LLM only for opt-in extraction |

**T0** is not a feature, it is a guarantee: a brain is plain markdown, so any
agent with file tools already has a working query strategy.

**T1** is the deterministic heart of brainpick. The
[compile pipeline](compile-pipeline.md) synthesizes the index from frontmatter
`description` fields, extracts the explicit link graph, computes backlinks,
tags, orphans and islands — all without a single model call, in under a
second. Everything T1 produces is defined by the
[artifact spec](artifact-spec.md).

**T2** adds semantic recall: chunks are embedded via whatever backend the
[embedding detection](embedding-detection.md) ladder finds, and hybrid
retrieval fuses keyword and vector hits (see
[search modes](search-modes.md)).

**T3** adds an entity/relation layer via the
[knowledge graph tier](knowledge-graph-tier.md): derived algorithmically from
links and tags by default (no model needed), with LLM extraction available
as an opt-in backend. It stays off only when explicitly configured that way;
graph-shaped queries then fall back to the T1 link graph.

The ladder is also the failure model: a missing model is a downgrade, not an
error. Every surface — MCP, CLI, the [holographic brain](holographic-brain.md)
— reports honestly which tier answered.
