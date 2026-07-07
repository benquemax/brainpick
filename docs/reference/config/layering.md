---
type: Reference
title: "Config layering and precedence"
description: "How brainpick.toml, brainpick.local.toml, environment variables and CLI flags stack — shared policy under machine-local endpoints under env under flags."
timestamp: 2026-07-08T00:00:00Z
---

# Config layering and precedence

Configuration is layered so shared policy and personal endpoints never collide.
`brainpick.toml` is the SHARED, versioned, for-everyone bundle policy (index
mode, module switches) and must never carry personal endpoints. A
`brainpick.local.toml` beside it holds MACHINE-LOCAL values (model endpoints,
tokens) and deep-merges over the shared file; [brainpick init](../cli/init.md)
writes detected endpoints there and gitignores it.

Precedence, weakest to strongest: **defaults → `brainpick.toml` →
`brainpick.local.toml` → environment (`BRAINPICK_*`) → CLI flags.** Tables merge
recursively; scalars and lists replace. An unparseable local layer is warned
about and ignored — the shared file still applies.

The env layer is detailed in [Environment overrides](env-overrides.md); the full
rules are [Spec: configuration](../spec/config.md). Back to [Configuration reference](../../reference-config.md).
