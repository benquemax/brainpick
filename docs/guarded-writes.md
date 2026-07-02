---
type: Concept
title: Guarded writes
description: brain_write lets agents add knowledge through MCP, but nothing touches the brain without passing the henxels contract first.
timestamp: 2026-07-02T00:00:00Z
---

# Guarded writes

Agents with only file access already write to a brain under henxels' git
hooks. But agents reaching the brain remotely — over streamable HTTP or SSE —
have no filesystem, so brainpick ships a write path from day one:
`brain_write`, the fifth of the [MCP tools](mcp-tools.md).

The guarantee is the principle "writes go through the suspenders": nothing
enters the brain unvalidated. The flow is deliberately boring:

1. Resolve the target to a kebab-case bundle path (create, replace, or
   append-section mode).
2. Write atomically, then run the henxels contract against exactly that
   path.
3. On violation: roll back and return henxels' instruction *verbatim* — the
   agent gets steering ("one concept per page, `type` from this list"), not
   a stack trace.
4. On pass: bump the `timestamp` frontmatter, trigger an incremental run of
   the [compile pipeline](compile-pipeline.md), and broadcast the change
   over [live deltas](live-deltas.md) — a remote agent's accepted write
   makes the [holographic brain](holographic-brain.md) visibly fire.

Writes are configuration-gated (`guarded` or `off`) and require the bearer
token whenever the server is bound beyond localhost. The division of labor
stays clean: brainpick never re-implements validation — henxels is the
referee, brainpick is the pipeline around it.
