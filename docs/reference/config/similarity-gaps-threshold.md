---
type: reference
about: thing
title: "similarity_gaps.threshold"
description: "Minimum cosine similarity to report a pair — default 0.75."
tags: [config, spec]
timestamp: 2026-08-03T00:00:00Z
---

# similarity_gaps.threshold

`threshold` under `[similarity_gaps]` sets the minimum cosine similarity two
documents' mean-pooled vectors must clear to appear as a candidate pair in
[`similarity-gaps.json`](../../similarity-gap-detector.md). Default `0.75`,
a float. Shared bundle policy (`brainpick.toml`), not curatorial — a
reviewed-and-rejected pair belongs in `similarity-gaps-allowlist.toml`
instead of a threshold tweak.

Paired with [similarity_gaps.max_pairs](similarity-gaps-max-pairs.md); the
generation algorithm is [Spec: similarity gaps](../spec/similarity-gaps.md).
Back to [Configuration reference](../../reference-config.md).
