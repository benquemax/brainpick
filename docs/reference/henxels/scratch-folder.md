---
type: reference
about: concept
title: "Henxel: the scratch folder survives"
description: "The henxel requiring _temp/ and its .gitkeep to exist, so scratch and pipeline intermediates never litter the repo root."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Henxel: the scratch folder survives

This henxel requires `_temp/` to exist with its `.gitkeep`
(`in: ./_temp`, `required_files: .gitkeep`). Scratch, screenshots and pipeline
intermediates go to `_temp/` — gitignored, but the folder itself committed — so
they never litter the repo root.

It is a house-keeping rule, sibling to the OKF-wiki henxels that govern this
[Reference](../../reference.md) volume. Back to [Henxels contract reference](../../reference-henxels.md).
