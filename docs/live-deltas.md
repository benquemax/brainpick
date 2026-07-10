---
type: article
about: process
title: Live deltas
description: The SSE protocol that streams graph changes to every open UI — the brain updates in real time, never by page refresh.
tags: [tier, ui]
timestamp: 2026-07-10T18:30:00Z
---

# Live deltas

Real-time is a hard requirement: when the bundle changes, every open view of
the brain updates — no page refresh, ever. The mechanism is a Server-Sent
Events stream at `GET /api/live`, implemented identically by both engines and
specified as part of the [artifact spec](artifact-spec.md)'s API layer.

The design leans on one load-bearing decision: deltas are **whole-graph
diffs**, not edit logs. After each run of the
[compile pipeline](compile-pipeline.md), the server diffs the previous graph
snapshot against the new one and emits added/removed/updated nodes and edges.
Correctness therefore never depends on incremental bookkeeping — a compile
triggered by cron, by the sibling runtime, or by hand still produces exact
deltas, because the server also watches the manifest's monotonic `seq`.

Resilience comes from the SSE basics done properly: event `id` equals the
manifest `seq`; the server keeps a ring buffer of recent deltas; a client
reconnecting with `Last-Event-ID` inside the buffer replays what it missed,
and one older than the buffer receives a full `graph.snapshot` to resync.
Heartbeat comments keep proxies and mobile radios honest, and the PWA
reconnects on `visibilitychange`.

The consumer that makes this worth it is the
[holographic brain](holographic-brain.md): joins animate in at their
neighbor's position, leaves fade, and recent activity renders as firing
pulses along edges — an agent writing into the brain is literally visible as
the brain firing. Agent-initiated [presentations](presentations.md) — an agent
highlighting the entries it cites and captioning them — ride the same channel
as `brain.show` events.
