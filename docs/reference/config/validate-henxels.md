---
type: reference
about: thing
title: "validate.henxels"
description: "When the compile pipeline runs the henxels contract — auto (default), always or never."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# validate.henxels

`henxels` under `[validate]` decides when the
[compile pipeline](../../compile-pipeline.md) runs the henxels contract during a
compile. Values `auto | always | never`, default `auto`: run it when a contract
is present, treating findings as compile warnings. `always` insists on it;
`never` skips it.

The contract it runs is the [Henxels contract reference](../../reference-henxels.md),
the same referee the [guarded writes](../../guarded-writes.md) path invokes.
Back to [Configuration reference](../../reference-config.md).
