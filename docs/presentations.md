---
type: article
about: process
title: Presentations
description: brain_show lets an agent spotlight a subgraph, fly the camera and caption it — pushed live to every open UI, so the agent side can reach across to the human side and say "let me show you".
tags: [agents, ui]
timestamp: 2026-07-10T18:30:00Z
---

# Presentations

The brain is one surface two audiences share. A presentation lets the *agent*
side reach across to the *human* side: an agent answering a question can
spotlight the subgraph it means, fly the human's camera to it, and caption it —
pushed live to every open UI. `brain_show` turns "let me explain" into "let me
show you."

A presentation is **ephemeral and advisory**. It changes what the UI
highlights, frames and captions — never the brain itself. There is no write, no
compile, no delta, and nothing to roll back. So unlike [guarded
writes](guarded-writes.md), `brain_show` is not behind `[serve] writes`; it
needs only the normal auth (a bearer token on a non-localhost bind).

## The tool

`brain_show({nodes?, focus?, mode?, annotation?, clear?})` is the sixth of the
[MCP tools](mcp-tools.md), and every argument is optional — small-model
ergonomics, forgiving to a fault. `nodes` are the ids to spotlight; they accept
doc paths (resolved the forgiving way `brain_read` resolves a doc) and entity
names from the [knowledge graph tier](knowledge-graph-tier.md), each resolving
to a graph id. Names that match nothing are dropped and listed back, never an
error. `focus` is the single id the camera flies to, defaulting to the first
resolved node; `mode` switches the view (`cosmos` or `brain`); `annotation` is
a short caption. An empty call, or `clear: true`, dismisses the presentation.

The same body reaches a running server over `POST /api/show`, and the CLI face
is `brainpick show <node…> [--focus] [--mode] [--annotate] [--clear]` — the
scripting handle for demos and tours.

## The live event

A presentation rides the [live deltas](live-deltas.md) channel as a
`brain.show` event. It carries its own monotonic presentation `seq` — distinct
from the manifest seq, so the UI always applies the newest and an out-of-order
frame never regresses it — and it is excluded from the graph-delta ring buffer.
The server holds the latest presentation and replays it once to every newly
connected client, so a UI joining mid-presentation still sees it; a cleared
presentation replays as the empty shape.

## What the UI does

On `brain.show`, the [holographic brain](holographic-brain.md) highlights the
`nodes` (reusing the search-highlight path), switches `mode` if set, flies the
camera to `focus`, and shows the `annotation` as a dismissible caption marked as
presented by an agent. A new presentation replaces the previous; a cleared one
removes the highlight and caption. Presentations compose with every view — the
flat cosmos, the hologram, and time travel alike.
