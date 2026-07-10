---
type: reference
about: concept
title: "Henxel: every link lands"
description: "The henxel that every relative and root-absolute internal link resolves to a real file — a warn-level nudge, not a block, so a ghost link can stand as a promise to write later."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Henxel: every link lands

This henxel checks every internal markdown link resolves to a real file —
both relative links (`links_resolve`) and bundle-absolute `/a/b` links
(`rooted_links_resolve` against `./docs`). It runs at `level: warn`, not
the default block: a link that lands nowhere is either a mistake or a
promise. A typo or a wrong path should be fixed or removed on the spot;
a page this wiki genuinely wants yet gets left standing — the algorithmic
[knowledge graph tier](../../knowledge-graph-tier.md) turns it into a
**ghost** entity, the standing write-next signal. What the henxel refuses
to let through silently is a link nobody meant.

Links are the edges of the brain: the same resolution the
[compile pipeline](../../compile-pipeline.md) uses to build
[the tiers](../../the-tiers.md)' T1 graph. Its reachability companion is
[Henxel: a concept is a node, not an orphan](no-orphans.md). Back to [Henxels contract reference](../../reference-henxels.md).
