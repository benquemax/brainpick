---
type: reference
about: thing
title: "brain.format"
description: "The brain-format version a bundle follows — 0 (absent) means a plain wiki, 1 means the brain format of spec/85; the stamp a future `brainpick migrate` bumps."
tags: [config, spec, brain-format]
timestamp: 2026-09-07T11:30:00Z
---

# brain.format

`format` under `[brain]` is the version stamp of [The brain](../../brain.md) this
bundle follows. `0` — the default when the key or the whole `[brain]` section is
absent — means the bundle is a wiki, not a brain; `1` means it follows
[Spec: brain format](../spec/brain-format.md) as written today.

Engines serve every format they know and print a migration hint for older
ones; a later format changes committed content only through a deterministic
`brainpick migrate --to N`, which bumps this stamp. Env override:
`BRAINPICK_BRAIN_FORMAT`. Why the stamp exists — and why it must be present
from the first brain — is in [The brain template](../../brain-template.md).

Back to [Configuration reference](../../reference-config.md).
