---
type: reference
about: concept
title: "Henxel: documented claims stay true"
description: "The pre-push henxel that runs codumentation validate, so documented claims are executable specifications rather than drift."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Henxel: documented claims stay true

This henxel runs `npx --yes codumentation validate` before every push
(`run_before_push`). Documented claims here are executable specifications
(principle 12); drift fails the push, not the reader.

It is the docs-facing sibling of [Henxel: the whole feature set works](whole-feature-set.md)
and leans on `compile --check-fresh` from the [compile pipeline](../../compile-pipeline.md).
Back to [Henxels contract reference](../../reference-henxels.md).
