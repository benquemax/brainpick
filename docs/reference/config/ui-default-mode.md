---
type: reference
about: thing
title: "ui.default_mode"
description: "The view the web UI opens in — cosmos (default) or brain."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# ui.default_mode

`default_mode` under `[ui]` sets the view the web UI opens in. Values `cosmos |
brain`, default `cosmos` (the flat GPU cosmos); `brain` opens straight into the
anatomical hologram. Like the node cap it reaches the client through
`GET /api/status`.

Both views are the [holographic brain](../../holographic-brain.md); an agent can
switch the live view per-presentation via [brain_show](../mcp/brain-show.md).
Its companion is [ui.max_nodes_mobile](ui-max-nodes-mobile.md). Back to [Configuration reference](../../reference-config.md).
