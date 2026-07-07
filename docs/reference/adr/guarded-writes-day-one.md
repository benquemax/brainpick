---
type: Decision
title: "ADR: guarded writes from day one"
description: "Why brainpick lets remote agents write to the brain from the first release, with henxels refereeing every write, rather than shipping a read-only MCP surface."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: guarded writes from day one

**Context.** Agents with file access already write under henxels' git hooks, but
remote agents over HTTP or SSE have no filesystem — and the reviewing architect
recommended a read-only MCP surface to stay safe.

**Decision.** Ship a write path from day one: `brain_write`, whose flow is
resolve, atomic write, run the henxels contract against that path, and roll back
with henxels' instruction verbatim on violation. Tom chose this over the
read-only recommendation. The full flow is [Guarded writes](../../guarded-writes.md).

**Alternatives considered.** A read-only MCP surface (the architect's
recommendation); a bespoke validator inside brainpick. Rejected — read-only
excludes remote agents from contributing knowledge, and re-implementing
validation would duplicate the referee and drift from it.

**Consequences.** Nothing enters the brain unvalidated, brainpick never
re-implements the referee, and writes are gated by [serve.writes](../config/serve-writes.md)
and a token off localhost (see [Authentication](../../authentication.md)). The
tool is one of the [MCP tools](../../mcp-tools.md), specified as
[brain_write](../mcp/brain-write.md); the same guarded core later grew a second
mouth, the browser editor. Back to [Architecture decision records](../../reference-adr.md).
