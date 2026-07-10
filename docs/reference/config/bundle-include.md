---
type: reference
about: thing
title: "bundle.include"
description: "The glob list of files scanned as bundle documents — default [\"**/*.md\"]."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# bundle.include

`include` under `[bundle]` is the list of globs that select bundle documents.
Default `["**/*.md"]` — every markdown file at any depth. Narrow it to scope a
bundle to a subtree, or widen it if your concepts use another extension.

Includes are filtered by [bundle.exclude](bundle-exclude.md); the resulting file
set is what [Spec: T1 artifacts](../spec/t1-artifacts.md) scans and what the
[compile pipeline](../../compile-pipeline.md) hashes into the manifest.
Back to [Configuration reference](../../reference-config.md).
