---
type: decision
about: concept
title: "ADR: LightRAG behind the KGBackend adapter"
description: "Why T3 entity extraction runs through a narrow KGBackend adapter and a neutral JSONL export, so LightRAG is fenced behind an extra and never leaks into consumers."
tags: [graph]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: LightRAG behind the KGBackend adapter

**Context.** The [Knowledge graph tier](../../knowledge-graph-tier.md) turns
prose into an entity/relation graph with a small LLM, and the obvious engine —
LightRAG — is a fast-moving dependency with its own working-directory format.

**Decision.** Put LightRAG behind a small `KGBackend` adapter gated by an install
extra, and normalize its output into a neutral JSONL export (entities and
relations) defined by the [Artifact spec](../../artifact-spec.md). Everything
downstream reads only the export, never LightRAG's internals — so a future
backend is a drop-in and the API-churn blast radius is one file.

**Alternatives considered.** Call LightRAG directly throughout; standardize on
its native store. Rejected — a direct dependency would spread churn across the
codebase and bind the Node engine to a Python library it cannot read.

**Consequences.** The explicit link graph (T1) and the extracted entity graph
(T3) stay genuinely independent layers, both engines read the export per
[Spec: T3 knowledge graph](../spec/t3-kg.md), and T3 stays the most optional,
most expensive rung of [The tiers](../../the-tiers.md) — switched by
[modules.graph](../config/modules-graph.md) and powered by
[models.extraction](../config/models-extraction.md). Back to
[Architecture decision records](../../reference-adr.md).
