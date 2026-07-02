---
type: Reference
title: Embedding detection
description: The ladder brainpick climbs to find an embedding backend — explicit config, Ollama, OpenAI-compatible endpoints, a local ONNX fallback, or an honest off.
timestamp: 2026-07-02T00:00:00Z
---

# Embedding detection

T2 of [the tiers](the-tiers.md) needs an embedding model, and onboarding is
supposed to feel like magic — so brainpick detects rather than interrogates.
At `init` (and on demand via `doctor`), it climbs a ladder of parallel,
short-timeout probes:

1. **Explicit configuration** always wins and is never second-guessed.
2. **Ollama** on its default port (and `OLLAMA_HOST`): installed embedding
   models are preferred in a sensible order (`nomic-embed-text` first); if
   Ollama is up but has no embedding model, init offers the exact
   `ollama pull` command.
3. **LM Studio / llama.cpp** as OpenAI-compatible endpoints.
4. **`OPENAI_API_KEY`** — with an explicit confirmation before defaulting to
   a paid API; local-first means asking first.
5. **fastembed** (Python engine only): an ONNX model with no daemon and no
   key — the fully-offline floor.
6. **Nothing found** — T2 stays off, with the exact command that would
   change that. T1 still shines; the first wow needs no key at all.

Whatever is chosen is fingerprinted (provider, model, dimensions) into the
[artifact spec](artifact-spec.md)'s embedding record; changing the model
later invalidates the vectors and triggers a clean re-embed automatically.
Query-time embeddings use the same record, which is how the Node engine
searches vectors it did not compile (see [runtime parity](runtime-parity.md)).
