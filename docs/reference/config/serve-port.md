---
type: reference
about: thing
title: "serve.port"
description: "The bind port for brainpick serve — default 4747."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# serve.port

`port` under `[serve]` is the TCP port [brainpick serve](../cli/serve.md) binds.
Default `4747` — the brainpick default across the docs and the
[Spec: REST API](../spec/rest-api.md). The CLI `--port` flag overrides it.

It pairs with [serve.host](serve-host.md) to form the served URL the
[holographic brain](../../holographic-brain.md) opens at. Back to [Configuration reference](../../reference-config.md).
