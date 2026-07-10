---
type: reference
about: thing
title: "serve.watch"
description: "Whether the server watches the bundle and recompiles on change — a boolean, default true."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# serve.watch

`watch` under `[serve]` is a boolean, default `true`: the server watches the
bundle, debounces bursts, recompiles incrementally, and feeds the
[live deltas](../../live-deltas.md) channel so every open UI updates without a
refresh. The CLI `--no-watch` flag turns it off for a static serve.

Watcher hygiene (debounce, coalescing, ignored directories) is specified in
[Spec: live deltas](../spec/live-deltas.md). Back to [Configuration reference](../../reference-config.md).
