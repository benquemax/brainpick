---
type: reference
about: thing
title: "brain_overview"
description: "The orientation tool — bundle name, counts, tier availability and the index tree — the progressive-disclosure root, with no required arguments."
tags: [mcp, agents]
timestamp: 2026-07-10T18:30:00Z
---

# brain_overview

`brain_overview()` takes no required arguments. It returns orientation: the
bundle name, `counts` (docs, edges, tags, orphans, ghosts), `tiers`, and a
`tree` of the index grouped with one-sentence descriptions, plus a `hint`.
Default budget 800 tokens. It is the progressive-disclosure root — the call an
agent makes first, before searching or reading.

Its CLI mirror is [brainpick overview](../cli/overview.md); the counts and
tiers it reports are [the tiers](../../the-tiers.md), and the whole set is
[MCP tools](../../mcp-tools.md). Back to [MCP tool reference](../../reference-mcp.md).
