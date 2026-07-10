---
type: reference
about: thing
title: "brainpick init"
description: "Detect the bundle and backends, write config, and compile T1 — the one command from zero to a living brain."
tags: [cli, spec]
timestamp: 2026-07-10T18:30:00Z
---

# brainpick init

`brainpick init [--root DIR]` is the onboarding command: it detects the bundle,
probes for embedding and extraction backends, writes configuration, and
compiles T1 so the brain is green at birth.

## Flags

- `--yes` — accept the opt-in choices (for example, recording `OPENAI_API_KEY` for T2).
- `--dry-run` — print what init would do without writing anything.

It writes detected endpoints into a machine-local layer (see
[Config layering and precedence](../config/layering.md)) and hands out agent
snippets. This is the [onboarding](../../onboarding.md) concept made concrete;
run [brainpick integrate](integrate.md) next to wire a harness, and
[brainpick doctor](doctor.md) if anything looks off. Back to [CLI reference](../../reference-cli.md).
