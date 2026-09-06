---
type: reference
about: thing
title: "brainpick doctor"
description: "Diagnose config, bundle, artifacts, backends and UI — the fix-it command when a brain misbehaves."
tags: [cli, spec]
timestamp: 2026-09-06T16:00:00Z
---

# brainpick doctor

`brainpick doctor [--root DIR]` diagnoses a brain end to end: the parsed
configuration, the bundle scan, the compiled artifacts, the detected embedding
and extraction backends, and the UI assets. It reports what is healthy and,
where something is wrong, the exact command to fix it — including the
[authentication](../../authentication.md) edge where a corrupt auth file fails
closed. Its last line, `hosts:`, counts the per-project `brainpick mcp --root`
entries still in your agent host configs and points at
`brainpick register --from-hosts`, the one-command move to
[federation](../../federation.md).

Reach for it after [brainpick init](init.md) when a tier is unexpectedly off,
or when [brainpick serve](serve.md) refuses a request. Back to [CLI reference](../../reference-cli.md).
