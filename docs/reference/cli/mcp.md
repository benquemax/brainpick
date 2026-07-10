---
type: reference
about: thing
title: "brainpick mcp"
description: "Speak MCP over stdio for agent hosts — the transport the init snippets configure."
tags: [cli, spec]
timestamp: 2026-07-10T18:30:00Z
---

# brainpick mcp

`brainpick mcp [--root DIR]` speaks the Model Context Protocol over stdio,
exposing the six [MCP tools](../../mcp-tools.md) to an agent host that spawns
it. Because stdio is the protocol channel, nothing prints to stdout here — it
is local by construction and never gated by auth. This is the transport the
[brainpick integrate](integrate.md) and onboarding snippets configure.

When [serve.writes](../config/serve-writes.md) is `off`, the server is created
with a write refusal so `brain_write` declines cleanly instead of mutating the
brain. The streamable HTTP and legacy SSE transports are served instead by
[brainpick serve](serve.md). Back to [CLI reference](../../reference-cli.md).
