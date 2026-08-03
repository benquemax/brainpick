---
type: article
about: concept
title: Similarity gap-detector
description: T2 vectors joined against T1's link graph to surface semantically-similar, unlinked document pairs — a second signal alongside the algorithmic knowledge graph, cheap and cumulative where LLM extraction was neither.
tags: [tier, graph]
timestamp: 2026-08-03T00:00:00Z
---

# Similarity gap-detector

The [knowledge graph tier](knowledge-graph-tier.md) derives entities from the
links and tags authors already wrote — proactive, but blind to a connection
nobody has written yet. The similarity gap-detector closes that blind spot
from the other direction: it joins vectors against the link graph to ask "what
reads as related that carries no edge?" — see
[ADR: the similarity gap-detector](reference/adr/similarity-gap-detector.md)
for the full reasoning behind why this replaces LLM extraction rather than
sitting alongside it.

## What it computes

At compile time, once T2 reports fresh:

1. Mean-pool each non-reserved document's chunk vectors into one
   representative vector.
2. Exclude any pair already linked — the same undirected adjacency
   `t1/graph.json`'s `islands` already derives, so a link in either direction
   rules a pair out regardless of kind.
3. Score every remaining pair by cosine similarity; keep what clears
   `[similarity_gaps] threshold` (default `0.75`), sorted highest first, capped
   at `max_pairs` (default `50`).

The result is `.brainpick/t1/similarity-gaps.json` — advisory, like
[timeline.json](time-machine.md): its layout is normative but its content
depends on whichever embedding backend produced T2's vectors, so consumers
must tolerate its absence (T2 off, the module off, or nothing computed yet).

## The two-route framing

This is deliberately not the only signal. The
[two-axis ontology](ontology.md) and the link graph itself already encode one
route — write-time discipline, nudged by the henxels contract
(`min_outbound_links`, `links_resolve`) — where the graph accumulates as
pages are written and every past linking decision stays valid forever. The
gap-detector is the second, complementary route: a cheap, cumulative
cross-check over what T2 already computed, catching what write-time
discipline alone would miss. Neither route repeats work on a page that is
already well-connected.

## Dismissing a reviewed pair

Not every similar-scoring pair deserves a link — some are just genre-similar
prose (two reference pages sharing structure and vocabulary without a real
conceptual tie). `similarity-gaps-allowlist.toml`, committed alongside
`brainpick.toml`, records that judgment permanently:

```toml
[[dismissed]]
a = "bar.md"        # canonical order: a < b lexicographically
b = "foo.md"
reason = "lexical echo, not a real connection"   # optional, human context
```

A dismissed pair is written to the artifact with `"status": "dismissed"` and
stops triggering the henxel below — reviewed once, never nagged about again.

## Surfaces

- `GET /api/similarity-gaps` — the artifact, or its empty shape when absent.
- `brain_overview`'s `similarity_gaps_open_count` — always present, `0` when
  off or absent.
- A "Top similarity gaps" section in the
  [AGENTS.md brain report](agent-integrations.md), present only when the
  artifact exists.
- A warn-level henxel, reading the compiled artifact and reporting one
  instruction per unresolved `open` pair: link the two pages, or dismiss the
  pair if reviewed and rejected. This is a genuine departure from every other
  henxel in this repo's contract — they all parse markdown directly, while
  this one reads a *compile output*, so `brainpick compile` (with T2 on) is
  what keeps it accurate; a stale or absent artifact degrades silently, never
  an error.

Dogfooding this repo's own `docs/` bundle (T2 already fresh here, so the
`auto` default activated with zero config changes) surfaced real, sensible
candidate pairs on the first real compile — proof the approach reads actual
prose, not just a fixture bundle.
