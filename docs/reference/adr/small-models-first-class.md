---
type: decision
about: concept
title: "ADR: small models are first-class citizens"
description: "Why every tool, schema and budget targets a local 27B-class model first, treating frontier models as a speed bonus rather than the design center."
tags: [agents, governance]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: small models are first-class citizens

**Context.** The target profile is a qwen3.6-class model running on the user's
own machine. A surface tuned for frontier models quietly breaks on small ones —
too many tools, rigid enums, unbounded outputs.

**Decision.** Design for the small model first. The [MCP tools](../../mcp-tools.md)
are few, with obvious names, at most one required argument, forgiving enums that
fall back to `auto` with a note, and a token budget on every result. One search
tool with a `mode` switch — see [Search modes](../../search-modes.md) — not a
tool per strategy.

**Alternatives considered.** Optimize for frontier models and let small models
cope; expose a rich, granular tool surface. Rejected — if a 27B cannot drive it,
it does not ship; frontier models just go faster on the same surface.

**Consequences.** The [MCP tool reference](../../reference-mcp.md) stays
deliberately small (`brain_search` returns titles and descriptions, never
bodies), and the [Knowledge graph tier](../../knowledge-graph-tier.md) extraction
runs conservatively. Power users trade some expressiveness for reliability across
the whole model spectrum. It is why every result in [The tiers](../../the-tiers.md)
is budget-shaped. Back to [Architecture decision records](../../reference-adr.md).
