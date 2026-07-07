---
type: Reference
title: "serve.transports"
description: "Which MCP transports the server mounts — default [\"streamable-http\"], with \"sse\" for the legacy transport."
timestamp: 2026-07-08T00:00:00Z
---

# serve.transports

`transports` under `[serve]` lists the MCP transports the served process mounts.
Default `["streamable-http"]`; add `"sse"` for the legacy Server-Sent-Events
transport at `/sse`. (stdio is a separate command,
[brainpick mcp](../cli/mcp.md), not a served transport.)

The tools carried over these transports are the [MCP tools](../../mcp-tools.md),
contracted in [Spec: MCP tools](../spec/mcp-tools.md). Back to [Configuration reference](../../reference-config.md).
