---
type: Reference
title: "brainpick serve"
description: "Serve REST, live deltas, the web UI and MCP from one process — with --host, --port, --no-watch and --open."
timestamp: 2026-07-08T00:00:00Z
---

# brainpick serve

`brainpick serve [--root DIR]` runs the whole serving surface in one process:
the static web UI at `/`, the REST API under `/api`, live SSE at `/api/live`,
and MCP at `/mcp`. It binds `127.0.0.1:4747` by default (from config) and, by
default, watches the bundle so edits recompile and stream live.

## Flags

- `--host HOST` — bind host (default: config or `127.0.0.1`).
- `--port PORT` — bind port (default: config or `4747`).
- `--no-watch` — serve without the file watcher.
- `--open` — open the UI in a browser once serving.

Serving realizes the [Spec: REST API](../spec/rest-api.md) and
[live deltas](../../live-deltas.md); the UI it hosts is the
[holographic brain](../../holographic-brain.md). Bind beyond localhost and you
need a [serve.token](../config/serve-token.md). Back to [CLI reference](../../reference-cli.md).
