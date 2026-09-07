---
type: reference
about: thing
title: "brainpick init"
description: "Detect the bundle and backends, write config, and compile T1 — the one command from zero to a living brain."
tags: [cli, spec]
timestamp: 2026-09-07T14:00:00Z
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
snippets.

`--root` names where the config lives, not necessarily the bundle: an existing
`brainpick.toml` with [bundle.root](../config/bundle-root.md) set is honoured,
so a [brain](../../brain.md) scaffolded by
`henxels init --template brainpick-brain` — config at the repo root, bundle in
`_brain/` — is detected in place, compiled into `_brain/.brainpick/`, and
announced with its [brain.format](../config/brain-format.md) and
[brain.audience](../config/brain-audience.md) plus the read order
(`skills/` first). The config itself is never rewritten; a missing
[bundle.id](../config/bundle-id.md) is suggested, not written. When no bundle
is found at all, init hands off to henxels and names both templates — a wiki
and a brain (see [Brain template](../../brain-template.md)). This is the [onboarding](../../onboarding.md) concept made concrete;
run [brainpick integrate](integrate.md) next to wire a harness, and
[brainpick doctor](doctor.md) if anything looks off. Back to [CLI reference](../../reference-cli.md).
