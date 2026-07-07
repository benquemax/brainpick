---
type: Reference
title: "Spec: MCP tools"
description: "The normative contract for the six tools — small-model ergonomics, budget_tokens, the guarded brain_write flow with optimistic concurrency, and resources."
timestamp: 2026-07-08T00:00:00Z
---

# Spec: MCP tools

The MCP spec fixes the six tools both engines expose verbatim, and makes
**small-model ergonomics normative**: at most one required argument
(`brain_write` is the sanctioned two-argument exception), unknown enum values
fall back to defaults with a note, every result carries a `hint`, and every
tool accepts `budget_tokens` (chars/4 estimate; descriptions survive, bodies
trim, truncation is announced).

It specifies each tool's arguments and returns, and the guarded `brain_write`
flow — resolve, atomic write, henxels referee, rollback-or-recompile-and-delta
— plus optimistic concurrency by `base_sha` with a merge ladder (three-way,
then an LLM merge, else a manual conflict). Two optional resources,
`brain://index` and `brain://doc/{path}`, complement the tools.

Each tool has its own page under the [MCP tool reference](../../reference-mcp.md);
the concept is [MCP tools](../../mcp-tools.md) and the write path is
[guarded writes](../../guarded-writes.md). Back to [Spec reference](../../reference-spec.md).
