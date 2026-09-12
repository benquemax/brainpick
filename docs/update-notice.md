---
type: article
about: concept
title: Update notice
description: "Agents never check for updates, so the brain tells them — a once-a-day registry lookup whose result surfaces in the AGENTS.md report, brain_overview and compile output, opt-out by config."
tags: [agents, engine]
timestamp: 2026-09-13T10:00:00Z
---

# Update notice

An agent never asks whether a newer brainpick exists — that is not a
question a session thinks to ask, and a fleet of harnesses each running its
own install drifts silently. So the engine tells them, proactively and where
they already look, without anyone checking.

## The lookup

When `[update] check` is `true` (the default —
[update.check](reference/config/update-check.md)), `compile` and `serve` look
up the latest published version of the running engine: PyPI's
`https://pypi.org/pypi/brainpick/json` for the Python engine, npm's
`https://registry.npmjs.org/brainpick/latest` for the Node engine. It happens
at most once per 24 hours, inside the same ≤ 300 ms probe budget as
[embedding detection](embedding-detection.md) — a miss is silent and cached
as a miss — and the answer is cached in `~/.cache/brainpick/latest.json`. It
never blocks, never fails a compile, and never runs in either engine's test
suite (`BRAINPICK_UPDATE_CHECK=false`, the environment override of the key,
is what the suites set). What it leaks is one HTTPS request to a public
registry per day; `check = false` in `brainpick.local.toml` keeps an
air-gapped or private machine silent for good.

## The notice

The result is a **notice** — `{current, latest, hint}` — present only when
`latest` is known *and* newer than `current` (a semantic comparison of the
`MAJOR.MINOR.PATCH` core; a pre-release never counts as newer). `hint` is
the exact upgrade command for the engine that noticed: `pip install -U
brainpick` or `npm install -g brainpick`. Where it surfaces is part of the
spec, so every harness sees it without asking:

- **The AGENTS.md brain report** ([Agent integrations](agent-integrations.md))
  gains one line after the bundle root — `- Engine: brainpick 0.5.0 — 0.6.0
  available: pip install -U brainpick`. It is the one non-deterministic line
  in the report and sits outside the conformance golden: omitted entirely
  when nothing newer is known, so a report refreshed after the upgrade
  loses it on the next compile. The fleet ritual of compiling the brain at
  session start makes this the line every agent reads first.
- **`brain_overview`** ([brain_overview](reference/mcp/brain-overview.md))
  carries an `update` field and its `hint` *starts* with the notice — an
  agent that reads only the first line of its first call learns it.
- **`brainpick compile`** prints one `note:` line, the same way it reports
  a stale tier.

Nothing is enforced: the engine keeps serving the brain it compiled, and the
notice is advice, not a gate. This is the progressive disclosure of
[MCP tools](mcp-tools.md) applied to the tool itself — the fact arrives at the moment of orientation,
at the cost of three short strings. The [Compile pipeline](compile-pipeline.md)
is where the lookup rides along.
