---
type: Reference
title: "bundle.exclude"
description: "Extra globs to drop from the scan — default [] — on top of the four directory names always excluded at any depth."
timestamp: 2026-07-08T00:00:00Z
---

# bundle.exclude

`exclude` under `[bundle]` drops files from the scan. Default `[]`. On top of
whatever you list, four directory names are **always** excluded at any depth:
`.brainpick/`, `.git/`, `_temp/` and `node_modules/`. Dotfiles and
dot-directories are otherwise scanned normally.

Use it to keep drafts or vendored markdown out of [the tiers](../../the-tiers.md).
It composes with [bundle.include](bundle-include.md); the always-excluded set is
spelled out in [Spec: manifest](../spec/manifest.md). Back to [Configuration reference](../../reference-config.md).
