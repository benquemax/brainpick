---
type: reference
about: thing
title: "models.embedding"
description: "The T2 embedding backend — kind, endpoint, model and dim — a machine-local table that belongs in brainpick.local.toml."
tags: [config, spec]
timestamp: 2026-09-13T09:30:00Z
---

# models.embedding

`[models.embedding]` pins the T2 embedding backend explicitly, short-circuiting
detection. Keys:

- `kind` — `ollama | openai-compatible | openai | fastembed | mock`.
- `endpoint` — the backend URL.
- `model` — the embedding model name. Prefer a multilingual one (`bge-m3`
  locally; OpenAI's `text-embedding-3-small` already is) unless the brain
  is English-only — `doctor` flags the known English-only families. A
  model change changes the fingerprint and re-embeds everything on the
  next compile, so switching is one edit and one compile.
- `dim` — vector dimension; `0` means discover it from the first response.
- `timeout` — seconds to wait for one batch of ≤ 64 texts (default `1800`).
  Raise it for a slow or shared backend; only a refused connection fails
  fast regardless. Overridable as `BRAINPICK_MODELS_EMBEDDING_TIMEOUT`.

An explicit table always wins and is never re-probed; leave it empty to let the
[embedding detection](../../embedding-detection.md) ladder decide. Because it
names a local endpoint, it belongs in the machine-local layer (see
[Config layering and precedence](layering.md)). It feeds
[Spec: T2 vectors](../spec/t2-vectors.md) and the
[modules.vectors](modules-vectors.md) switch. Back to [Configuration reference](../../reference-config.md).
