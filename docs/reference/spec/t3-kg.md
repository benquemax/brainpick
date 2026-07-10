---
type: reference
about: concept
title: "Spec: T3 knowledge graph"
description: "A second, extracted view — the neutral export (entities, relations, kg-meta) with normative layout but advisory content, and normative query semantics."
tags: [spec]
timestamp: 2026-07-10T18:30:00Z
---

# Spec: T3 knowledge graph

T3 records what the prose is *about*, independent of the links authors drew. It
is split: the **neutral export** — `t3/entities.jsonl`, `t3/relations.jsonl`,
`t3/kg-meta.json` — has a **normative layout** (field names, id normalization,
ordering, and the query semantics over it), while its **content is advisory**
(a model writes it, so two runs may disagree). Entity ids are the name
normalized (NFC, lowercased, non-alphanumeric runs to `-`), so unchanged
entities stay stable across recompiles and keep the live deltas quiet.

The reference extractor (LightRAG, Python-only) is private; consumers read only
the export. The Node engine never extracts — it delegates to a Python sibling
or skips — but T3 *query* is native in both. Conformance tests consumers
against a hand-authored export fixture, never the extractor.

This is the [knowledge graph tier](../../knowledge-graph-tier.md), the T3 rung
of [the tiers](../../the-tiers.md), reached by
[brain_neighbors](../mcp/brain-neighbors.md) `layer=entities`. Back to [Spec reference](../../reference-spec.md).
