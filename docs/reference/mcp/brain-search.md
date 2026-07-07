---
type: Reference
title: "brain_search"
description: "Search returning titles and descriptions with a match reason — never full bodies — across auto, keyword, semantic and graph modes."
timestamp: 2026-07-08T00:00:00Z
---

# brain_search

`brain_search({query, mode?, limit?, budget_tokens?})` returns `hits` of
`{path, title, description, score, why}` — descriptions only, never full
bodies — plus `used_modes`, `degraded_from`, `truncated` and a `hint`. `mode ∈
auto|keyword|semantic|graph` (default `auto`); an unknown mode falls back to
`auto` with a note. `why` is one clause naming the match reason. Default budget
1200.

Its modes and honest degradation are [search modes](../../search-modes.md); its
CLI mirror is [brainpick search](../cli/search.md). Back to [MCP tool reference](../../reference-mcp.md).
