---
type: article
about: thing
title: Time machine
description: The history dimension — brainpick distills the bundle's git history into a timeline artifact so you can scrub through the brain's past and watch it grow.
tags: [ui]
timestamp: 2026-07-10T18:30:00Z
---

# Time machine

A brain kept as markdown in a git repository has a past, and brainpick turns
that past into a dimension you can travel. Scrub backwards and the brain
shrinks to its younger self; scrub forwards and watch it grow, each concept
flaring into existence on the commit that first wrote it — in the flat cosmos
and inside the [holographic brain](holographic-brain.md) alike.

## The timeline artifact

The [compile pipeline](compile-pipeline.md) distills the bundle's git history
into a single advisory artifact, `timeline.json`, from one `git log` — it never
recompiles past commits. The artifact records, oldest commit first, which
concept docs were added, modified or deleted at each commit, plus a per-doc
lifecycle (created / modified / deleted dates). Its layout is part of the
[artifact spec](artifact-spec.md); like a layout, its *content* is advisory —
git history differs across clones, so it is never byte-golden, and a bundle
that is not a git repository simply has no timeline and the feature hides.

Because a commit only earns a timeline entry by adding or editing a real
concept doc — the generated `index.md` and `log.md` are excluded — the timeline
tracks the growth of knowledge, not of build output.

## Travelling through a moment

Given any instant in the span, the view reconstructs the graph without a
recompile: a node is present when it was created at or before that instant and
not yet deleted, and an edge is drawn when both of its endpoints are present.
The reconstruction reuses the same morph, firing-pulse and camera machinery the
[holographic brain](holographic-brain.md) already runs, so travelling in time
composes with every other view — and it echoes how [live deltas](live-deltas.md)
animate change in the present, only now the change is history replaying.

A moment is shareable: a deep link opens the machine at a chosen commit, so a
point in the brain's story can be handed to another agent or human directly.
