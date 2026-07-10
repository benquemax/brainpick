---
type: reference
about: thing
title: "brain_show"
description: "Spotlight a subgraph live in every open UI — every argument optional, ephemeral and advisory, gated by auth only, not by writes."
tags: [mcp, agents]
timestamp: 2026-07-10T18:30:00Z
---

# brain_show

`brain_show({nodes?, focus?, mode?, annotation?, clear?})` — every argument is
optional. `nodes` accept doc paths (fuzzy/kebab-resolved) and entity names;
unresolved entries are dropped and listed. `focus` defaults to the first
resolved node; `clear: true` (or an empty call) clears the presentation. It
returns `{ok, shown, dropped, seq, hint}` where `seq` is a monotonic
*presentation* counter distinct from the manifest seq.

Unlike [brain_write](brain-write.md) it never writes the brain, so it is NOT
behind [serve.writes](../config/serve-writes.md) — only normal auth. It is the
tool behind [presentations](../../presentations.md); its CLI mirror is
[brainpick show](../cli/show.md). Back to [MCP tool reference](../../reference-mcp.md).
