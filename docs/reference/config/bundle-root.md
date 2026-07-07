---
type: Reference
title: "bundle.root"
description: "Where the OKF bundle lives relative to the config file — default \".\" — so the config can sit at a repo root pointing at a subdirectory bundle."
timestamp: 2026-07-08T00:00:00Z
---

# bundle.root

`root` under `[bundle]` points at the OKF bundle relative to the config file.
Default `"."` (the config sits in the bundle root). Set it when `brainpick.toml`
lives at a repo root but the bundle is a subdirectory, so one config governs a
bundle that is not its own parent.

It works with [bundle.include](bundle-include.md) and
[bundle.exclude](bundle-exclude.md) to define exactly which files are scanned
into [the tiers](../../the-tiers.md). Back to [Configuration reference](../../reference-config.md).
