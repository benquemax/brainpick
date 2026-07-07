---
type: Decision
title: "ADR: the holographic brain and cosmos UI"
description: "Why the human face is a procedural holographic brain that morphs to a flat GPU cosmos, touch-first and installable, rendering the exact graph agents query rather than decorative data."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: the holographic brain and cosmos UI

**Context.** Humans need to see the brain, and the north star is a movie scene —
knowledge floating as a holographic brain — that must also run on a phone and keep
the repo's MIT license clean.

**Decision.** Ship two layouts in one scene: a flat 2D cosmos for analysis and a
3D brain whose form is a procedural signed distance field (no external mesh), with
communities mapped to lobes and a GPU morph between them via dual position
buffers. It is a touch-first, installable PWA from day one, and it renders exactly
the graph agents query — the [Holographic brain](../../holographic-brain.md).

**Alternatives considered.** A conventional 2D graph view only; a commissioned or
CC0 anatomical brain mesh. Rejected — a flat view undersells one brain, two faces,
and a licensed mesh would entangle the MIT license; a procedural SDF needs no
asset-licensing decision at all.

**Consequences.** The renderer carries morph plumbing from the first UI commit; a
mobile GPU budget via [ui.max_nodes_mobile](../config/ui-max-nodes-mobile.md) (node
caps, cluster aggregation) keeps phones cool; and the [ui.default_mode](../config/ui-default-mode.md)
picks the opening view. The same scene later hosts the entities of the
[Knowledge graph tier](../../knowledge-graph-tier.md), the [Time machine](../../time-machine.md)
and agent [Presentations](../../presentations.md), all driven live by
[Live deltas](../../live-deltas.md). Back to [Architecture decision records](../../reference-adr.md).
