---
type: Concept
title: Knowledge graph tier
description: T3 extracts an entity/relation layer with a small LLM via LightRAG behind an adapter — a second, independent view of the brain alongside the explicit link graph.
timestamp: 2026-07-02T00:00:00Z
---

# Knowledge graph tier

T3 of [the tiers](the-tiers.md) turns prose into an entity/relation graph:
a small LLM (the design target is a local qwen3.6-class model) reads chunks
and extracts who and what the brain talks about, and how those things relate.

The engine is LightRAG, but always behind a small `KGBackend` adapter and an
installation extra — the dependency is fenced, the API churn has a one-file
blast radius, and a future backend is a drop-in. More important than the
engine is the **neutral export**: extraction results are normalized into
plain JSONL entity and relation files defined by the
[artifact spec](artifact-spec.md). Everything downstream — the Node engine,
graph-mode [search modes](search-modes.md), the entity layer of the
[holographic brain](holographic-brain.md) — reads only the export, never
LightRAG's internals.

A fact worth internalizing: LightRAG does **not** follow markdown links. It
strips markup and extracts semantically from text. The explicit link graph
(T1) and the entity graph (T3) are therefore genuinely independent layers —
one records what authors connected on purpose, the other what the text is
actually about. The UI's layer toggle exists to let you watch them disagree
productively.

Small-model reality is designed in, not hoped away: extraction runs last so
deterministic freshness never waits on it, concurrency is conservative,
incremental inserts reuse the compile change set, and a `--sample` dry-run
previews extraction quality on a handful of documents before committing to a
full pass.
