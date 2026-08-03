---
type: reference
about: thing
title: "modules.graph"
description: "The T3 switch — on (default, algorithmic derivation), auto, or off."
tags: [config, spec]
timestamp: 2026-08-03T00:00:00Z
---

# modules.graph

`graph` under `[modules]` switches T3 on or off. Values `on | auto | off`,
default `on` — the algorithmic backend derives entities and relations from
the pages themselves (ghosts, tags, link co-occurrence) with zero LLM cost,
so a governed wiki gets its entity graph for free; `auto` behaves
identically today (there is no second backend for it to differ on — kept
for symmetry with [modules.vectors](modules-vectors.md)); `off` keeps the
tier dark and graph-shaped queries fall back to the T1 link graph.
`algorithmic` is accepted as a synonym for `on`, since every scaffolded
`brainpick.toml` already spells it that way.

There is no second backend to choose anymore — LLM extraction (LightRAG)
was tried and removed; see
[ADR: the similarity gap-detector](../adr/similarity-gap-detector.md) for
why, and [modules.similarity_gaps](modules-similarity-gaps.md) for the
signal that replaced its role. The algorithmic backend is described in the
[knowledge graph tier](../../knowledge-graph-tier.md)
([Spec: T3 knowledge graph](../spec/t3-kg.md)). Back to
[Configuration reference](../../reference-config.md).
