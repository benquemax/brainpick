---
type: reference
about: thing
title: "modules.similarity_gaps"
description: "The gap-detector switch — auto (default, on iff T2 is fresh), on or off."
tags: [config, spec]
timestamp: 2026-08-03T00:00:00Z
---

# modules.similarity_gaps

`similarity_gaps` under `[modules]` switches the
[similarity gap-detector](../../similarity-gap-detector.md). Values
`auto | on | off`, default `auto`: it rides T2's freshness for free — enabled
whenever T2 reports fresh, with no separate enabling instruction, since
absence just means nothing to compute yet, not a missing prerequisite. `on`
behaves identically to `auto` today; `off` disables it regardless of T2.

Tuning lives in [`[similarity_gaps]`](similarity-gaps-threshold.md) — the
threshold and pair cap, not this switch. The tier itself is
[Spec: similarity gaps](../spec/similarity-gaps.md). Back to
[Configuration reference](../../reference-config.md).
