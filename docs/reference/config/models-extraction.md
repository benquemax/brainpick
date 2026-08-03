---
type: reference
about: thing
title: "models.extraction"
description: "The chat model behind the brain_write merge resolver — its one real production purpose since T3's LLM extraction was removed; kind, endpoint, model and api_key_env."
tags: [config, spec]
timestamp: 2026-08-03T00:00:00Z
---

# models.extraction

`[models.extraction]` names a chat model. Keys:

- `kind` — `ollama | openai-compatible | mock`.
- `endpoint` — the backend URL.
- `model` — the chat model name.
- `api_key_env` — the *name* of an environment variable holding the key, never the key itself.

Its one real production purpose is the LLM merge strategy in
[brain_write](../mcp/brain-write.md) / [guarded writes](../../guarded-writes.md)
— T3's own LLM extraction was tried and removed (see
[ADR: the similarity gap-detector](../adr/similarity-gap-detector.md)), so
the [knowledge graph tier](../../knowledge-graph-tier.md) no longer consumes
this table for anything real; the `mock` kind survives only as an internal
test hook exercising the `KGBackend` seam
([ADR: the KGBackend adapter](../adr/kgbackend-adapter.md)), never a
user-facing extraction choice. Being machine-local, it lives in
`brainpick.local.toml` — see
[Config layering and precedence](layering.md). Back to
[Configuration reference](../../reference-config.md).
