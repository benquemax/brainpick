---
type: reference
about: concept
title: "Spec: presentations"
description: "Agent-driven views — the normative brain_show payload (nodes, focus, mode, annotation, seq), its ephemeral advisory nature, the live event and UI behaviour."
tags: [spec]
timestamp: 2026-07-10T18:30:00Z
---

# Spec: presentations

A presentation lets the agent side reach across to the human side: spotlight a
subgraph, fly the camera, switch view, and caption it — pushed live to every
open UI. It is **ephemeral and advisory**: it changes what the UI highlights,
never the brain (no write, no compile, no delta). The payload shape is
normative: `nodes` (doc paths and/or entity ids), `focus`, `mode`
(`cosmos|brain|null`), `annotation`, and a server-assigned monotonic `seq`
distinct from the manifest seq.

`brain_show` resolves nodes forgivingly, drops and lists unresolved ones,
defaults `focus` to the first node, and treats an empty call or `clear: true`
as a clear. The server holds the latest presentation and replays it once to a
newly connected client. Because it never writes, it is gated by auth only, not
by the writes switch.

This is the contract for [presentations](../../presentations.md),
[brain_show](../mcp/brain-show.md), and the `brain.show`
[live deltas](../../live-deltas.md) event. Back to [Spec reference](../../reference-spec.md).
