---
type: reference
about: thing
title: "models.extraction"
description: "The chat model that powers T3 extraction and doubles as the brain_write merge resolver — kind, endpoint, model and api_key_env."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# models.extraction

`[models.extraction]` names the chat model behind T3 extraction — which also
doubles as the merge resolver for stale writes. Keys:

- `kind` — `ollama | openai-compatible | mock`.
- `endpoint` — the backend URL.
- `model` — the chat model name.
- `api_key_env` — the *name* of an environment variable holding the key, never the key itself.

It drives the [knowledge graph tier](../../knowledge-graph-tier.md)
([Spec: T3 knowledge graph](../spec/t3-kg.md)) and the LLM merge strategy in
[brain_write](../mcp/brain-write.md) / [guarded writes](../../guarded-writes.md).
Being machine-local, it lives in `brainpick.local.toml` — see
[Config layering and precedence](layering.md). Back to [Configuration reference](../../reference-config.md).
