---
type: Reference
title: "modules.graph"
description: "The T3 entity-graph switch — off (default), auto or on."
timestamp: 2026-07-08T00:00:00Z
---

# modules.graph

`graph` under `[modules]` controls the T3 knowledge-graph tier. Values `auto |
on | off`, default `off` — T3 is the most expensive, most optional tier, so it
is opt-in. `auto` enables it when an extraction endpoint is reachable; `on`
forces it; `off` keeps it dark and graph-shaped queries fall back to the T1 link
graph.

It powers the [knowledge graph tier](../../knowledge-graph-tier.md)
([Spec: T3 knowledge graph](../spec/t3-kg.md)) using
[models.extraction](models-extraction.md). Back to [Configuration reference](../../reference-config.md).
