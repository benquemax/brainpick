---
type: Decision
title: "ADR: whole-graph deltas over SSE"
description: "Why the brain updates live by diffing whole-graph snapshots over Server-Sent Events, so correctness never depends on incremental edit-log bookkeeping and any compile source yields exact deltas."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: whole-graph deltas over SSE

**Context.** Every open view must update without a page refresh, and a compile can
be triggered by watch mode, by cron, by the sibling runtime, or by hand — the live
channel cannot assume it saw every edit.

**Decision.** After each run of the [Compile pipeline](../../compile-pipeline.md),
diff the previous graph snapshot against the new one and emit added, removed and
updated nodes and edges over Server-Sent Events at `GET /api/live`, keyed to the
manifest's monotonic `seq`. Deltas are whole-graph diffs, not edit logs — the
design of [Live deltas](../../live-deltas.md).

**Alternatives considered.** An incremental edit log; WebSockets. Rejected — an
edit log makes correctness depend on fragile bookkeeping any out-of-band compile
would break, and WebSockets add bidirectional weight the one-way stream does not
need.

**Consequences.** Any compile source produces exact deltas; a ring buffer plus
`Last-Event-ID` replay handles reconnects; and the same channel carries agent
[Presentations](../../presentations.md) — see
[ADR: brain_show, agent-driven presentations](brain-show-presentations.md). The
trade is re-diffing the graph each compile. The protocol is fixed by
[Spec: live deltas](../spec/live-deltas.md) within [Spec: REST API](../spec/rest-api.md).
Back to [Architecture decision records](../../reference-adr.md).
