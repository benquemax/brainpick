---
type: Reference
title: "modules.vectors"
description: "The T2 semantic-vectors switch — auto (default), on or off."
timestamp: 2026-07-08T00:00:00Z
---

# modules.vectors

`vectors` under `[modules]` controls the T2 vector tier. Values `auto | on |
off`, default `auto`: brainpick detects an embedding backend and enables T2 when
one is found, staying off (with an enabling instruction) when none is. `on`
forces it; `off` disables it regardless of backends.

`auto` runs the [embedding detection](../../embedding-detection.md) ladder; the
tier itself is [Spec: T2 vectors](../spec/t2-vectors.md), one rung of
[the tiers](../../the-tiers.md). The backend is chosen from
[models.embedding](models-embedding.md). Back to [Configuration reference](../../reference-config.md).
