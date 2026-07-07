---
type: Reference
title: "CLI reference"
description: "Every brainpick subcommand and its flags, derived from the argparse CLI — compile and serve, the read mirrors, writes, presentations, onboarding and auth."
timestamp: 2026-07-08T00:00:00Z
---

# CLI reference

`brainpick` is a stdlib argparse CLI. `brainpick --version` prints the
version; every subcommand takes `--root` (the bundle root, default the current
directory). The commands fall into groups: compile and serve the brain, mirror
the read tools in the terminal, present live, onboard, and manage auth.

## Build and serve

- [brainpick compile](reference/cli/compile.md) — compile the bundle into `.brainpick/` artifacts.
- [brainpick serve](reference/cli/serve.md) — serve REST, live deltas, the web UI and MCP in one process.
- [brainpick mcp](reference/cli/mcp.md) — speak MCP over stdio for agent hosts.

## Query the brain (the read mirrors)

- [brainpick overview](reference/cli/overview.md) — one screen of the whole brain.
- [brainpick search](reference/cli/search.md) — search the compiled brain.
- [brainpick read](reference/cli/read.md) — read one doc, forgivingly resolved.
- [brainpick neighbors](reference/cli/neighbors.md) — walk the link graph around a doc.
- [brainpick show](reference/cli/show.md) — present a subgraph live in every open UI.

## Onboard, integrate, diagnose

- [brainpick init](reference/cli/init.md) — detect the bundle and backends, write config, compile T1.
- [brainpick integrate](reference/cli/integrate.md) — install brainpick into an agent harness.
- [brainpick doctor](reference/cli/doctor.md) — diagnose config, bundle, artifacts, backends and UI.

## Authentication

- [brainpick token](reference/cli/token.md) — manage bearer tokens for agents.
- [brainpick password](reference/cli/password.md) — manage the web UI password.

These verbs mirror the [MCP tools](mcp-tools.md) and the [compile pipeline](compile-pipeline.md).
Back to [Reference](reference.md).
