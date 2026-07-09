---
type: Reference
title: "bundle.id"
description: "A random opaque identifier minted by brainpick init and committed with the bundle — an address for this brain, never a credential — default \"\" (absent)."
timestamp: 2026-07-10T00:00:00Z
---

# bundle.id

`id` under `[bundle]` is a random opaque identifier — the recommended shape
is 21-char nanoid-style `[a-z0-9]` — minted once by `brainpick init` and
committed with the bundle in the SHARED `brainpick.toml`, not the
machine-local layer: the identity travels with the bundle wherever it is
cloned or served. Default `""` (absent) on bundles that predate this key.

Consumers treat it as an address, never a credential — it grants no access
on its own. It exists for multi-brain serving, the desktop app's brain
registry, and future MCP routing like `/mcp/{brainId}`.

`brainpick init` mints one into a newly written `brainpick.toml`. An existing
config without one is never rewritten (init owns nothing it did not create),
but `init` prints a paste-able `[bundle] id` fragment so you can add it
yourself, the same treatment as its henxels freshness-gate suggestion.
`GET /api/status` ships the current value as `id`, `null` when absent —
see [Configuration reference](../../reference-config.md).
