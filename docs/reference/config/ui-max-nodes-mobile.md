---
type: reference
about: thing
title: "ui.max_nodes_mobile"
description: "The node cap the web UI applies on mobile or weak GPUs — default 8000 — shipped to the client so it stops guessing from the GPU tier."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# ui.max_nodes_mobile

`max_nodes_mobile` under `[ui]` is the node budget the web UI applies on mobile
or weak-GPU clients. Default `8000`. The server ships it to the browser via
`GET /api/status`, so the client sizes the cosmos from policy instead of
guessing from the detected GPU tier.

It configures the [holographic brain](../../holographic-brain.md) and is carried
in the status response of [Spec: REST API](../spec/rest-api.md). Its companion is
[ui.default_mode](ui-default-mode.md). Back to [Configuration reference](../../reference-config.md).
