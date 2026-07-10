---
type: reference
about: thing
title: "modules.ui"
description: "Whether the web UI is served — a boolean, default true."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# modules.ui

`ui` under `[modules]` is a boolean, default `true`, deciding whether
[brainpick serve](../cli/serve.md) mounts the static web UI at `/`. Turn it off
for a headless deployment that only needs the REST and MCP surfaces.

The UI it gates is the [holographic brain](../../holographic-brain.md); its
client-side sizing comes from the [ui.max_nodes_mobile](ui-max-nodes-mobile.md)
and [ui.default_mode](ui-default-mode.md) keys. Back to [Configuration reference](../../reference-config.md).
