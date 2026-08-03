---
type: reference
about: concept
title: "Spec: T3 knowledge graph"
description: "A second, derived view — the neutral export (entities, relations, kg-meta) is normative for the algorithmic backend, the only one this contract ships, with normative query semantics."
tags: [spec]
timestamp: 2026-08-03T00:00:00Z
---

# Spec: T3 knowledge graph

T3 records the concepts *between* the pages, independent of the links authors
drew. It is split: the **neutral export** — `t3/entities.jsonl`,
`t3/relations.jsonl`, `t3/kg-meta.json` — has a **normative layout** (field
names, id normalization, ordering, and the query semantics over it), and for
the algorithmic backend its **content is normative too** — the derivation is
exact, so both engines produce byte-identical exports, proven by goldens.
Entity ids are the name normalized (NFC, lowercased, non-alphanumeric runs to
`-`), so unchanged entities stay stable across recompiles and keep the live
deltas quiet.

Algorithmic derivation is native in both engines — no delegation, no extra,
no endpoint. The `KGBackend` seam that would carry a real extractor stays in
code (a `mock` test hook exercises it), but no extractor ships today — see
[ADR: the similarity gap-detector](../adr/similarity-gap-detector.md) for why
LLM extraction (LightRAG) was tried and removed, and
[Spec: similarity gaps](similarity-gaps.md) for what replaced its role.
Conformance tests consumers against a hand-authored export fixture,
independent of whichever backend produced it.

This is the [knowledge graph tier](../../knowledge-graph-tier.md), the T3 rung
of [the tiers](../../the-tiers.md), reached by
[brain_neighbors](../mcp/brain-neighbors.md) `layer=entities`. Back to [Spec reference](../../reference-spec.md).
