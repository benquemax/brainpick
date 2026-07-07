---
type: Reference
title: "brainpick compile"
description: "Compile the bundle into .brainpick/ artifacts — with --full, --check-fresh, --only, --sample and --watch."
timestamp: 2026-07-08T00:00:00Z
---

# brainpick compile

`brainpick compile [--root DIR]` turns the OKF bundle into the tiered
`.brainpick/` artifacts. It scans and hashes every file, diffs against the
manifest, and rebuilds only what changed. On success it prints a stat line:
`compiled: N docs · M links · G ghosts · O orphans · seq S`.

## Flags

- `--full` — ignore the manifest and rebuild everything.
- `--check-fresh` — verify freshness without writing; exits `0` fresh, `1` stale with a one-line instruction naming the command to run.
- `--only {t1,t2,t3}` — compile a single tier (t2/t3 reuse the compiled docs substrate).
- `--sample N` — a T3 preview: extract only the first N docs' chunks and summarize.
- `--watch` — stay running and recompile incrementally on changes.

This is the command behind the [compile pipeline](../../compile-pipeline.md);
its tiers are [the tiers](../../the-tiers.md), and `--check-fresh` is what the
[documented claims stay true](../henxels/docs-truth.md) freshness gate leans on.
Back to [CLI reference](../../reference-cli.md).
