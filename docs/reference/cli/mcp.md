---
type: reference
about: thing
title: "brainpick mcp"
description: "Speak MCP over stdio for agent hosts — the transport the init snippets configure."
tags: [cli, spec]
timestamp: 2026-09-06T11:30:00Z
---

# brainpick mcp

`brainpick mcp [--root [ALIAS=]DIR ...]` speaks the Model Context Protocol
over stdio, exposing the six [MCP tools](../../mcp-tools.md) to an agent host
that spawns it. Because stdio is the protocol channel, nothing prints to stdout
here — it is local by construction and never gated by auth. This is the
transport the [brainpick integrate](integrate.md) and onboarding snippets
configure.

`--root` is repeatable, and optional. With none, the server fronts every brain
in the registry kept by [brainpick register](register.md) plus the bundle the
working directory sits in; with several, exactly those (an `ALIAS=` prefix
names one). More than one brain makes the server *federated* — merged search,
`alias:path` addressing, `scope` — as described in
[federation](../../federation.md); a single brain serves the plain payloads it
always did.

When [serve.writes](../config/serve-writes.md) is `off` (for every brain of a
federated set), the server is created with a write refusal so `brain_write`
declines cleanly instead of mutating the brain. The streamable HTTP and legacy SSE transports are served instead by
[brainpick serve](serve.md). Back to [CLI reference](../../reference-cli.md).
