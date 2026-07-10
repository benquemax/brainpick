---
type: reference
about: concept
title: "Spec: live deltas"
description: "The SSE protocol — hello, graph.delta, graph.snapshot, compile.status and brain.show — reconstructible from the stream alone, with a replay ring buffer."
tags: [spec]
timestamp: 2026-07-10T18:30:00Z
---

# Spec: live deltas

`GET /api/live` streams Server-Sent Events, and the graph a client renders MUST
be reconstructible from the stream alone — never a page refresh. Events:
`hello` (opens every connection with the current seq), `graph.delta`
(whole-graph diffs between consecutive compiles, with full node records added
and ids removed), `graph.snapshot` (a full resync), `compile.status`
(`running|done|failed`), and a `: ping` heartbeat at least every 30 s.

The SSE `id` equals `seq`; a ring buffer (≥256 deltas) lets a reconnect with
`Last-Event-ID` replay misses, else the server sends one snapshot. Deltas are
idempotent by seq. The `brain.show` event rides the same stream but carries a
presentation seq, sets no SSE id, and is excluded from the ring buffer.

This is the protocol behind [live deltas](../../live-deltas.md), fed by the
[compile pipeline](../../compile-pipeline.md)'s watch mode; `brain.show` belongs
to [presentations](../../presentations.md). Back to [Spec reference](../../reference-spec.md).
