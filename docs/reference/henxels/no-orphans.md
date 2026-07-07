---
type: Reference
title: "Henxel: a concept is a node, not an orphan"
description: "The henxel requiring every concept doc to link out at least once — a concept is a node in the knowledge graph, never an island."
timestamp: 2026-07-08T00:00:00Z
---

# Henxel: a concept is a node, not an orphan

This henxel requires every concept doc to have at least one outbound internal
link (`min_outbound_links: 1`). A concept is a node in the knowledge graph, not
an orphan; link text is the target's title, so a stripped link reads as a clean
entity mention.

Note the compile's *orphan* metric is the mirror image — a doc with no *inbound*
links — but both push the same way: keep the graph connected. This is why every
page in this [Reference](../../reference.md) volume links to its hub and beyond.
Its counterpart is [Henxel: every link lands](links-land.md). Back to [Henxels contract reference](../../reference-henxels.md).
