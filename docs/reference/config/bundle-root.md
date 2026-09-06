---
type: reference
about: thing
title: "bundle.root"
description: "Where the OKF bundle lives relative to the config file — default \".\" — so the config can sit at a repo root pointing at a subdirectory bundle."
tags: [config, spec]
timestamp: 2026-09-03T12:00:00Z
---

# bundle.root

`root` under `[bundle]` points at the OKF bundle relative to the config file.
Default `"."` (the config sits in the bundle root). Set it when `brainpick.toml`
lives at a repo root but the bundle is a subdirectory, so one config governs a
bundle that is not its own parent. Every command that takes `--root` applies
the indirection — [brainpick compile](../cli/compile.md) (including
`--check-fresh`), the query mirrors, [brainpick mcp](../cli/mcp.md),
[brainpick serve](../cli/serve.md) and [brainpick doctor](../cli/doctor.md) — so
`--root` always names where the config lives, and the compiled `.brainpick/`
and generated index land in the bundle it points at.

It works with [bundle.include](bundle-include.md) and
[bundle.exclude](bundle-exclude.md) to define exactly which files are scanned
into [the tiers](../../the-tiers.md). Back to [Configuration reference](../../reference-config.md).
