---
type: reference
about: thing
title: "half_life.default"
description: "Bundle-wide half-life in days for the ranking factor that fades stale docs — default 0, nothing fades."
tags: [config, spec]
timestamp: 2026-09-13T12:30:00Z
---

# half_life.default

`default` under `[half_life]` is the bundle-wide half-life in days: a
document's search score is multiplied by `max(2^(-age/half_life), 1/16)`
where `age` is the days since its OKF `timestamp` ([Half-life](../../half-life.md)).
Default `0`, meaning **nothing fades** — every bundle that never heard of
the factor ranks exactly as before. A float or int; negative values clamp
to `0`.

Overridden per folder by [half_life.folders](half-life-folders.md) and per
document by the frontmatter `half_life` field (days, `0` = never fades).
Env: `BRAINPICK_HALF_LIFE_DEFAULT`
([env overrides](env-overrides.md)). Back to
[Configuration reference](../../reference-config.md).
