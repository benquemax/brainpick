---
type: reference
about: thing
title: "brain_read"
description: "Read one doc with forgiving resolution (path, stem, fuzzy title), returning frontmatter, outline, content and neighbors, shaped to a token budget."
tags: [mcp, agents]
timestamp: 2026-09-12T18:10:00Z
---

# brain_read

`brain_read({doc, sections?, budget_tokens?})` resolves `doc` forgivingly:
exact path → unique file stem → fuzzy title; an ambiguous match returns a
`disambiguation` list instead of content. It returns `frontmatter`, an
`outline`, `content`, and `neighbors` (`in`/`out` as `{path, title}`), with
`truncated` and a `hint`. Over budget it returns the outline plus a leading
excerpt and a hint to request `sections`. Default budget 2000.

On a skill (`type: skill`, [Skills](../../skills.md)) the payload
adds `skill: {depends_on, dependents, tools}` — prerequisites and dependents
as `{path, title}`, each tool as `{path, exists}` — and the hint says to read
the prerequisites first and run the tools yourself: brainpick never executes
a tool.

Behind a federated server ([federation](../../federation.md)) `doc` may be
`alias:path`; an unqualified one is resolved across every brain (one hit
answers, several disambiguate with qualified paths), and the result names its
`brain`.

Its CLI mirror is [brainpick read](../cli/read.md); walk outward from a read
with [brain_neighbors](brain-neighbors.md). Back to [MCP tool reference](../../reference-mcp.md).
