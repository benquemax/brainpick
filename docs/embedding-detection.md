---
type: reference
about: concept
title: Embedding detection
description: The ladder brainpick climbs to find an embedding backend — explicit config, Ollama, OpenAI-compatible endpoints, an in-process local ONNX model in either engine, or an honest off.
tags: [tier, engine]
timestamp: 2026-07-10T18:30:00Z
---

# Embedding detection

T2 of [the tiers](the-tiers.md) needs an embedding model, and onboarding is
supposed to feel like magic — so brainpick detects rather than interrogates.
At `init` (and on demand via `doctor`), it climbs a ladder of parallel,
short-timeout probes for rungs 2–4; rung 5 is opt-in configuration, not
probed, since loading a local model is a download/load, not a reachability
check:

1. **Explicit configuration** always wins and is never second-guessed.
2. **Ollama** on its default port (and `OLLAMA_HOST`): installed embedding
   models are preferred in a sensible order (`nomic-embed-text` first); if
   Ollama is up but has no embedding model, init offers the exact
   `ollama pull` command.
3. **LM Studio / llama.cpp** as OpenAI-compatible endpoints.
4. **`OPENAI_API_KEY`** — with an explicit confirmation before defaulting to
   a paid API; local-first means asking first.
5. **An in-process local model** — no daemon, no key, the fully-offline
   floor, in either engine. Python: `fastembed` ONNX (`[vectors-local]`
   extra, `kind = "fastembed"`, model explicit — e.g. `BAAI/bge-small-en-v1.5`).
   Node: `@huggingface/transformers` (transformers.js) on `onnxruntime-node`,
   an optionalDependency exactly like `@lancedb/lancedb` — absence degrades
   with an install instruction, never a crash (`kind = "local"`, default
   model `nomic-ai/nomic-embed-text-v1.5`, quantized). Cuts the Ollama
   dependency for a Python-free desktop daemon. Weights cache outside
   `node_modules` (survives reinstalls) at `~/.cache/brainpick/transformers`.
6. **Nothing found** — T2 stays off, with the exact command that would
   change that. T1 still shines; the first wow needs no key at all.

Whatever is chosen is fingerprinted (provider, endpoint, model, dimensions)
into the [artifact spec](artifact-spec.md)'s embedding record; changing the
model later invalidates the vectors and triggers a clean re-embed
automatically.
Query-time embeddings use the same record, which is how the Node engine
searches vectors it did not compile (see [runtime parity](runtime-parity.md)).
