---
type: reference
about: thing
title: "update.check"
description: "Whether compile and serve may look up the latest published brainpick version once a day — true (default) or false for an air-gapped or private machine."
tags: [config, spec]
timestamp: 2026-09-13T10:00:00Z
---

# update.check

`check` under `[update]` switches the [Update notice](../../update-notice.md):
`true` (default) lets `compile` and `serve` ask the package registry of the
running engine for its latest version at most once per 24 hours, cached in
`~/.cache/brainpick/latest.json`; `false` never touches the network for it.
The environment override `BRAINPICK_UPDATE_CHECK=false` does the same and is
what both engines' test suites set ([Environment overrides](env-overrides.md)).
Because it is a machine policy rather than a property of the bundle, it
belongs in `brainpick.local.toml` ([Config layering and precedence](layering.md)).
Back to [Configuration reference](../../reference-config.md).
