---
type: reference
about: thing
title: "index.file"
description: "The filename brainpick generates the index into — default \"index.md\"."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# index.file

`file` under `[index]` names the file the generated index is written into.
Default `"index.md"` — the OKF-reserved bundle index. Change it only if your
bundle's entry document has a different name.

How much of that file is managed is [index.mode](index-mode.md); that the bundle
root must have an index at all is enforced by
[Henxel: the bundle root has an index](../henxels/root-index.md). Back to [Configuration reference](../../reference-config.md).
