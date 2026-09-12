---
type: reference
about: thing
title: "half_life.folders"
description: "Folder → days table for the half-life ranking factor; the longest folder prefix of a doc's path wins."
tags: [config, spec]
timestamp: 2026-09-13T12:30:00Z
---

# half_life.folders

`[half_life.folders]` is a table of bundle-relative folder path → half-life
in days, the middle layer of [Half-life](../../half-life.md) resolution:
it beats [half_life.default](half-life-default.md) and yields to a
document's own frontmatter `half_life`. Keys are folder paths without a
trailing slash (`journals`, `journals/archive`); a key matches a document
when it equals the path's leading folders — `journals` covers
`journals/2026-07-01.md` but not `journalsx/y.md`. When several match, the
longest wins, so `journals/archive = 7` overrides `journals = 30` for the
archive. `0` means never fades; a non-numeric value is ignored.

The table is the bundle author's declaration, which is what keeps
[structure agnosticism](../../structure-agnosticism.md) intact — the engine
interprets no folder name on its own.

```toml
[half_life.folders]
journals = 30
"journals/archive" = 7
skills = 0
```

Env: `BRAINPICK_HALF_LIFE_FOLDERS="journals=30,skills=0"`
([env overrides](env-overrides.md)). Back to
[Configuration reference](../../reference-config.md).
