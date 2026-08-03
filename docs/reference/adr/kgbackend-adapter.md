---
type: decision
about: concept
title: "ADR: the KGBackend adapter"
description: "Why T3 entity derivation runs through a narrow KGBackend seam and a neutral JSONL export even with one shipped backend — a test/mock hook, not a hedge for LightRAG, which this contract has since dropped."
tags: [graph]
timestamp: 2026-08-03T00:00:00Z
---

# ADR: the KGBackend adapter

**Context.** T3 originally ran an LLM extractor (LightRAG) behind this same
seam — the reasoning at the time was that LightRAG was a fast-moving
dependency with its own working-directory format, so isolating it behind an
adapter would contain the churn. It has since been removed entirely: see
[ADR: the similarity gap-detector](similarity-gap-detector.md) for why —
LightRAG never earned its cost on a governed wiki, re-deriving the whole
graph from zero on every pass instead of crediting what was already
well-connected. The question this ADR now answers is narrower: with no real
extractor left, does the `KGBackend` seam still earn its keep?

**Decision.** Yes, for two reasons that have nothing to do with LightRAG
specifically. First, it is a genuine test hook: `MockKGBackend` exercises the
exporter's normalization logic (id slugging, disambiguation, canonical
sorting) end to end without a model, coverage that would otherwise need a
real extraction backend to exist just to test the code that consumes one.
Second, it keeps `AlgorithmicKGBackend` — the one backend that actually
ships — genuinely decoupled from the export format: the neutral JSONL shape
(entities, relations) defined by the [Artifact spec](../../artifact-spec.md)
is still the only thing any consumer reads, never a backend's internals.

**Alternatives considered.**

- *Delete the seam along with LightRAG.* Considered — with one backend, an
  adapter interface is arguably unnecessary indirection. Rejected: it would
  also delete `MockKGBackend`'s test coverage of the normalization path, and
  collapsing `AlgorithmicKGBackend` directly into the exporter would make a
  future extractor (if one ever proves its worth on a corpus algorithmic
  derivation can't help — see the still-open "onboarding miner for legacy
  corpora" idea) a rewrite instead of a drop-in.
- *Keep LightRAG as an opt-in second backend.* This repo's actual prior
  state, reversed by [ADR: the similarity gap-detector](similarity-gap-detector.md) —
  rejected there for cost reasons that don't need repeating here.

**Consequences.** The explicit link graph (T1) and the derived entity graph
(T3) stay genuinely independent layers, both engines read the export per
[Spec: T3 knowledge graph](../spec/t3-kg.md), and T3 stays the most optional
rung of [The tiers](../../the-tiers.md) — switched by
[modules.graph](../config/modules-graph.md), now `on | auto | off` with no
backend choice left to make. `[models.extraction]` no longer has a T3
consumer at all — it keeps exactly one live purpose, powering
[brain_write's merge resolver](../spec/mcp-tools.md). The role LLM extraction
used to aim at — surfacing connections the files don't yet state — is now
[the similarity gap-detector's](similarity-gap-detector.md), not this
adapter's. Back to [Architecture decision records](../../reference-adr.md).
