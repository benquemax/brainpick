---
type: reference
about: thing
title: "brain_search"
description: "Search returning titles and descriptions with a match reason — never full bodies — across auto, keyword, semantic and graph modes."
tags: [mcp, agents]
timestamp: 2026-09-06T14:40:00Z
---

# brain_search

`brain_search({query, mode?, limit?, scope?, budget_tokens?})` returns `hits`
of `{path, title, description, score, why}` — descriptions only, never full
bodies — plus `used_modes`, `degraded_from`, `truncated` and a `hint`. `mode ∈
auto|keyword|semantic|graph` (default `auto`); an unknown mode falls back to
`auto` with a note. `why` is one clause naming the match reason. Default budget
1200.

Behind a federated server ([federation](../../federation.md)) every brain in
`scope` — `all` (default), `here`, `me`, or a comma-separated alias list — is
searched, hits are merged by rank (scores are not comparable across brains,
so `hits` is rank-ordered and each keeps its brain's native `score`), each
carries its `brain`, paths become `alias:path`, and the answer adds `searched`
and `contributing`.

Its modes and honest degradation are [search modes](../../search-modes.md); its
CLI mirror is [brainpick search](../cli/search.md). Back to [MCP tool reference](../../reference-mcp.md).
