---
type: Reference
title: "Henxel: the bundle root has an index"
description: "The henxel that docs/ has an index.md and every top-level concept is referenced in it — maintained by hand until brainpick generates it."
timestamp: 2026-07-08T00:00:00Z
---

# Henxel: the bundle root has an index

This henxel requires the bundle root to have an `index.md` and every top-level
concept to be referenced in it (`in: ./docs`, `required_files: index.md`,
`referenced_in: docs/index.md`). Its scope is non-recursive, so only direct
children of `docs/` must appear — which is exactly why this volume adds its five
category hubs and the [Reference](../../reference.md) hub to the hand-maintained
list, while the per-item pages live in subdirectories and reach the index only
through the generated block.

Until brainpick generates the index (principle 4), the concepts list is
maintained by hand and refereed here. It pairs with
[Henxel: reserved files stay frontmatter-free](reserved-frontmatter-free.md).
Back to [Henxels contract reference](../../reference-henxels.md).
