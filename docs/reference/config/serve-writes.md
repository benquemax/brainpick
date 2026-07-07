---
type: Reference
title: "serve.writes"
description: "Whether writes are exposed and how — guarded (default) or off."
timestamp: 2026-07-08T00:00:00Z
---

# serve.writes

`writes` under `[serve]` gates the write path. Values `guarded | off`, default
`guarded`: `brain_write` and `PUT /api/docs` are exposed but every write must
pass the henxels contract first; `off` removes the write surface entirely (and
[brainpick mcp](../cli/mcp.md) hands the tool a refusal).

This is the switch behind [guarded writes](../../guarded-writes.md) and
[brain_write](../mcp/brain-write.md); on non-localhost binds writes additionally
require a [serve.token](serve-token.md). Back to [Configuration reference](../../reference-config.md).
