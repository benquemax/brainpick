---
type: Decision
title: "ADR: brain_show, agent-driven presentations"
description: "Why an agent can spotlight and caption a subgraph live in every UI through an ephemeral, advisory brain_show that rides the delta channel and is not gated behind writes."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: brain_show, agent-driven presentations

**Context.** The brain is one surface two audiences share, and an agent answering
a question should be able to reach across to the human and say "let me show you"
— not only describe in text.

**Decision.** Add `brain_show` as the sixth of the [MCP tools](../../mcp-tools.md):
it spotlights nodes, flies the camera and shows a caption, pushed live to every
open UI. It is ephemeral and advisory — no write, no compile, no rollback — so it
is gated by normal auth only, not by `[serve] writes`, and every argument is
optional. This is [Presentations](../../presentations.md).

**Alternatives considered.** Text-only agents; modeling a presentation as a write
with compile and rollback. Rejected — text cannot point at the graph, and treating
an ephemeral highlight as a write would drag in the whole
[Guarded writes](../../guarded-writes.md) machinery for nothing.

**Consequences.** Presentations ride the channel of
[ADR: whole-graph deltas over SSE](whole-graph-deltas-sse.md) as a `brain.show`
event with their own monotonic seq; the server replays the latest to newly
connected clients; and the feature composes with the cosmos, the
[Holographic brain](../../holographic-brain.md) and time travel. The payload is
fixed by [Spec: presentations](../spec/presentations.md) and the tool by
[brain_show](../mcp/brain-show.md). Back to [Architecture decision records](../../reference-adr.md).
