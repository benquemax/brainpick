---
type: Reference
title: "brainpick show"
description: "Present a subgraph live in every open UI — posts to a running server, with --focus, --mode, --annotate and --clear."
timestamp: 2026-07-08T00:00:00Z
---

# brainpick show

`brainpick show [NODES...] [--root DIR]` posts a presentation to a running
server's `POST /api/show`, which resolves it and broadcasts to every open UI.
Unlike the read mirrors, `show` is a network client — it never resolves
locally; the live server does.

## Flags

- `NODES...` — doc paths or entity names to spotlight.
- `--focus ID` — a single id to fly the camera to (defaults to the first node).
- `--mode {cosmos,brain}` — switch the UI view.
- `--annotate TEXT` — a short caption over the presentation.
- `--clear` — dismiss the current presentation.
- `--host`, `--port`, `--token` — reach a guarded or remote server.
- `--json` — print the raw server response as JSON.

This is the CLI face of [presentations](../../presentations.md) and the
[brain_show](../mcp/brain-show.md) tool. Back to [CLI reference](../../reference-cli.md).
