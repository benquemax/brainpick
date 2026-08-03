---
type: reference
about: concept
title: "Spec: similarity gaps"
description: "T2 vectors joined against T1's link graph to surface semantically-similar, unlinked document pairs — advisory in content, normative in layout, with a dismiss/allowlist mechanism."
tags: [spec]
timestamp: 2026-08-03T00:00:00Z
---

# Spec: similarity gaps

`similarity-gaps.json` joins the vectors [T2](t2-vectors.md) already computed
against the link graph [T1](t1-artifacts.md) already built to surface pairs
that read as similar but carry no edge — the second of the
[two routes](../adr/similarity-gap-detector.md) that replace what LLM
extraction used to attempt. It is **advisory in content** (the join depends
on whichever embedding backend produced T2's vectors, so it is only
byte-golden against the deterministic mock embedder) but its **layout is
normative**.

Generation: mean-pool each non-reserved document's chunk vectors into one
representative vector, exclude any pair already linked (the same undirected
adjacency `t1/graph.json`'s `islands` already derives), score the rest by
cosine similarity, keep what clears `[similarity_gaps] threshold`, cap at
`max_pairs`. The file carries `pairs` (sorted by score descending, canonical
`a < b` order), plus the `threshold`/`max_pairs` that produced the pass. An
empty `pairs` list is valid — a well-linked wiki genuinely has no gaps. It
rides [T2](t2-vectors.md)'s freshness (`[modules] similarity_gaps = "auto"`,
the default) and is never tracked as a manifest tier — a stage failure or T2
being off simply omits the file, same posture as
[timeline.json](timeline.md).

A pair present in `similarity-gaps-allowlist.toml` (sibling to
`brainpick.toml`, committed, never frontmatter) is written with
`"status": "dismissed"` instead of `"open"` — a human's "not a real
connection" judgment, remembered permanently. Surfaced via
`GET /api/similarity-gaps` ([REST API](rest-api.md)), `brain_overview`'s
`similarity_gaps_open_count` ([MCP tools](mcp-tools.md)), a "Top similarity
gaps" section in the [AGENTS.md brain report](t1-artifacts.md), and a
warn-level henxel that reads the artifact directly — a genuine departure
from every other henxel in this contract, which all parse markdown instead.
Back to [Spec reference](../../reference-spec.md).
