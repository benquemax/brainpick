---
type: reference
about: thing
title: "serve.max_asset_bytes"
description: "The upload size cap for POST /api/assets — default 8388608 bytes (8 MiB)."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# serve.max_asset_bytes

`max_asset_bytes` under `[serve]` caps the size of an image uploaded through
`POST /api/assets`. Default `8388608` — 8 MiB. Uploads over the cap are
rejected; the endpoint also restricts to image content types and sanitizes
filenames.

The asset path is part of [guarded writes](../../guarded-writes.md) (the browser
editor's image embeds) and is specified in
[Spec: REST API](../spec/rest-api.md). Back to [Configuration reference](../../reference-config.md).
