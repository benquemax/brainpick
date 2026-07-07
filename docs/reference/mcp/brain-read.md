---
type: Reference
title: "brain_read"
description: "Read one doc with forgiving resolution (path, stem, fuzzy title), returning frontmatter, outline, content and neighbors, shaped to a token budget."
timestamp: 2026-07-08T00:00:00Z
---

# brain_read

`brain_read({doc, sections?, budget_tokens?})` resolves `doc` forgivingly:
exact path → unique file stem → fuzzy title; an ambiguous match returns a
`disambiguation` list instead of content. It returns `frontmatter`, an
`outline`, `content`, and `neighbors` (`in`/`out` as `{path, title}`), with
`truncated` and a `hint`. Over budget it returns the outline plus a leading
excerpt and a hint to request `sections`. Default budget 2000.

Its CLI mirror is [brainpick read](../cli/read.md); walk outward from a read
with [brain_neighbors](brain-neighbors.md). Back to [MCP tool reference](../../reference-mcp.md).
