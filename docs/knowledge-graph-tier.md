---
type: article
about: concept
title: Knowledge graph tier
description: T3 derives an entity/relation layer algorithmically — ghosts and tags, no model needed — the only backend this tier ships; LLM extraction was tried and dropped in favor of the similarity gap-detector.
tags: [tier, graph]
timestamp: 2026-08-03T00:00:00Z
---

# Knowledge graph tier

T3 of [the tiers](the-tiers.md) adds a second, independent view of the brain:
an entity/relation graph alongside the explicit link graph T1 already builds.
One backend produces it — **algorithmic**, always on unless
`[modules] graph = "off"` — derives entities from what the files already
carry, no model, no endpoint:

- Dead link targets become **ghost** entities (concepts referenced but not
  yet written).
- Frontmatter tags become **tag** entities.
- Entities sharing a source doc get a **co-occurrence** relation.

This is pure computation over already-compiled T1 records, so it runs
natively in both engines and its export is byte-reproducible — conformance
holds it to the same golden standard as T1. An empty export (a
fully-written, untagged wiki) is valid and fresh — consumers serve an empty
layer, never an error.

LLM extraction (LightRAG) was tried here and removed — see
[ADR: the similarity gap-detector](reference/adr/similarity-gap-detector.md)
for why it never earned its cost on a governed wiki, re-deriving the whole
graph from zero every pass instead of crediting what links already covered.
The `KGBackend` seam it ran behind stays in code (algorithmic plus a `mock`
test hook), documented in
[ADR: the KGBackend adapter](reference/adr/kgbackend-adapter.md), in case a
future extractor ever earns its keep on a corpus algorithmic derivation
can't help.

Every consumer — the Node engine, graph-mode [search modes](search-modes.md),
the entity layer of the [holographic brain](holographic-brain.md),
`brain_neighbors layer=entities` — reads only the **neutral export**: plain
JSONL entity and relation files defined by the
[artifact spec](artifact-spec.md), never a backend's private internals.

T3 is one signal, not the whole story: the
[similarity gap-detector](similarity-gap-detector.md) is a second,
complementary one — vectors joined against the link graph to surface
connections nobody has written yet, replacing the role LLM extraction used
to aim at without its cost.

Every page's own `type` and `about` frontmatter — [the two-axis
ontology](ontology.md) — is a third source T3 will eventually draw on
alongside links and tags: a page's declared ontological subject is exactly
the kind of structured signal this tier already specializes in surfacing.
