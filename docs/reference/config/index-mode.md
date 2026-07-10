---
type: reference
about: thing
title: "index.mode"
description: "How brainpick manages the generated index.md — section (default), manage or off."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# index.mode

`mode` under `[index]` decides how much of `index.md` brainpick owns. Values:

- `section` (default) — brainpick owns only the fenced block appended at end of file; you keep the rest.
- `manage` — brainpick owns the whole file below the frontmatter.
- `off` — the file is left untouched.

The fence mechanics and hash stamp are defined in
[Spec: T1 artifacts](../spec/t1-artifacts.md). The file it writes into is set by
[index.file](index-file.md). Back to [Configuration reference](../../reference-config.md).
