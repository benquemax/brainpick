---
type: reference
about: thing
title: "brainpick whats-new"
description: "What changed in brainpick since this brain was last compiled, and what an agent should do about it — read from the shipped release ledger, offline."
tags: [cli, agents]
timestamp: 2026-09-13T14:00:00Z
---

# brainpick whats-new

`brainpick whats-new [--root DIR] [--since VERSION] [--all] [--json]` prints
the releases between the version that last compiled this brain and the one
running — read from the release ledger every package ships
([What's new notice](../../whats-new.md)), so it works offline and says the
same thing in both engines. Each release is a heading, `## 0.5.0
(2026-09-11)`, its summary, and one line per change — `- added (brain):
Brain format 2.` — followed by **Do next:** — a numbered checklist in the
order to do them: the oldest shown release's actions first, each in ledger
order, and the [brainpick migrate](migrate.md) line last when the brain's
stamped format is behind. Walk it top to bottom
([Upgrading a brain](../../upgrading.md)).

`--since` defaults to the `generator.version` of `.brainpick/manifest.json`
— the engine that last compiled the brain — which is exactly what the
notice's hint suggests: `run brainpick whats-new --since 0.4.0`. With no
manifest, or nothing between, it prints the running release alone. `--all`
prints the whole ledger; `--json` the raw entries plus the `notice` object
the [Compile pipeline](../../compile-pipeline.md) would emit.

Back to [CLI reference](../../reference-cli.md).
