---
type: reference
about: thing
title: "modules.graph"
description: "The T3 backend switch — algorithmic (default), lightrag, auto or off."
tags: [config, spec]
timestamp: 2026-07-12T12:10:00Z
---

# modules.graph

`graph` under `[modules]` picks the T3 backend. Values
`algorithmic | lightrag | auto | off`, default `algorithmic` — the
algorithmic backend derives entities and relations from the pages themselves
(ghosts, tags, link co-occurrence) with zero LLM cost, so a governed wiki
gets its entity graph for free. `lightrag` opts into LLM extraction using
[models.extraction](models-extraction.md); `auto` picks lightrag when an
extraction model is configured and falls back to algorithmic otherwise (the
legacy value `on` behaves like auto); `off` keeps the tier dark and
graph-shaped queries fall back to the T1 link graph.

Both backends are described in the
[knowledge graph tier](../../knowledge-graph-tier.md)
([Spec: T3 knowledge graph](../spec/t3-kg.md)). Back to
[Configuration reference](../../reference-config.md).
