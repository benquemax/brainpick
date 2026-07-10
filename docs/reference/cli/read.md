---
type: reference
about: thing
title: "brainpick read"
description: "Read one doc from the brain by path, stem or approximate title — the brain_read tool as a CLI verb."
tags: [cli, spec]
timestamp: 2026-07-10T18:30:00Z
---

# brainpick read

`brainpick read DOC [--root DIR]` opens one document from the compiled brain.
`DOC` resolves forgivingly: an exact path (`kuu.md`), a file stem (`kuu`), or an
approximate title. Add `--json` for the raw MCP payload. Like the other mirrors
it is read-only and never compiles.

It mirrors [brain_read](../mcp/brain-read.md); pair it with
[brainpick neighbors](neighbors.md) to walk outward from what you read, and
[brainpick search](search.md) to find the doc in the first place. Back to [CLI reference](../../reference-cli.md).
