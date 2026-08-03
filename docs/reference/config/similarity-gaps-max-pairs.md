---
type: reference
about: thing
title: "similarity_gaps.max_pairs"
description: "Cap on reported pairs, highest score first — default 50."
tags: [config, spec]
timestamp: 2026-08-03T00:00:00Z
---

# similarity_gaps.max_pairs

`max_pairs` under `[similarity_gaps]` caps how many candidate pairs
[`similarity-gaps.json`](../../similarity-gap-detector.md) reports, after
sorting by score descending (ties broken by path). Default `50`, an integer.

Paired with [similarity_gaps.threshold](similarity-gaps-threshold.md); the
generation algorithm is [Spec: similarity gaps](../spec/similarity-gaps.md).
Back to [Configuration reference](../../reference-config.md).
