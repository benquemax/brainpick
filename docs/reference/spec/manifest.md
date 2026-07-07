---
type: Reference
title: "Spec: manifest"
description: "The root of trust — manifest.json — plus canonical serialization, the monotonic seq counter, tier status and the freshness check."
timestamp: 2026-07-08T00:00:00Z
---

# Spec: manifest

`.brainpick/manifest.json` is the normative root of trust: what was compiled,
from which inputs, at which sequence number. This spec also fixes **canonical
serialization** for every normative artifact — UTF-8, LF, one trailing newline;
JSON with lexicographically sorted keys and 2-space indent; JSONL compact and
sorted by primary key; POSIX bundle-relative paths; ISO-8601-UTC `Z`
timestamps at second precision.

Key fields: `files` (every scanned path → bytes + sha256), `seq` (a monotonic
counter that bumps only when a normative artifact or the generated index
changes — a no-op compile never bumps it), `tiers` (each `fresh|stale|off`),
and `index_md.managed`. The freshness check (`compile --check-fresh`) verifies
the scan's path→sha map and the index stamp without writing.

It underwrites the [compile pipeline](../../compile-pipeline.md)'s
incrementality; the tiers it tracks are [the tiers](../../the-tiers.md).
Back to [Spec reference](../../reference-spec.md).
