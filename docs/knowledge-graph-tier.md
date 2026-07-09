---
type: Concept
title: Knowledge graph tier
description: T3 derives an entity/relation layer algorithmically by default (ghosts and tags, no model needed) — LightRAG's LLM extraction is an opt-in second backend behind the same adapter.
timestamp: 2026-07-10T00:00:00Z
---

# Knowledge graph tier

T3 of [the tiers](the-tiers.md) adds a second, independent view of the brain:
an entity/relation graph alongside the explicit link graph T1 already builds.
Two backends produce it, chosen by `[modules] graph`:

- **algorithmic** (the default) — derives entities from what the files
  already carry, no model, no endpoint. Dead link targets become **ghost**
  entities (concepts referenced but not yet written); frontmatter tags become
  **tag** entities; entities sharing a source doc get a **co-occurrence**
  relation. Pure computation over already-compiled T1 records, so it runs
  natively in both engines and its export is byte-reproducible — conformance
  holds it to the same golden standard as T1.
- **lightrag** (opt-in, the `brainpick[graph]` extra) — a small LLM (the
  design target is a local qwen3.6-class model) reads chunks and extracts
  who and what the brain talks about, richer on prose whose structure is not
  yet encoded in links, at model cost. Python-only: the Node engine delegates
  `compile --only t3` to an installed Python sibling, or skips with the exact
  enabling command.

Whatever the backend, every consumer — the Node engine, graph-mode
[search modes](search-modes.md), the entity layer of the
[holographic brain](holographic-brain.md), `brain_neighbors layer=entities` —
reads only the **neutral export**: plain JSONL entity and relation files
defined by the [artifact spec](artifact-spec.md), never a backend's private
internals. An empty export (a fully-written, untagged wiki) is valid and
fresh — consumers serve an empty layer, never an error.

A fact worth internalizing about LightRAG: it does **not** follow markdown
links. It strips markup and extracts semantically from text, so its entity
graph and T1's link graph are genuinely independent layers even when it runs.
The algorithmic backend inverts this — its entities are drawn exactly from
the links and tags authors already wrote — but the two views still diverge
in what they emphasize (a ghost names what is missing, prose extraction names
what is discussed). The UI's layer toggle exists to let you watch them
disagree productively.

Small-model reality (for the lightrag backend) is designed in, not hoped
away: extraction runs last so deterministic freshness never waits on it,
concurrency is conservative, incremental inserts reuse the compile change
set, and a `--sample` dry-run previews extraction quality on a handful of
documents before committing to a full pass.
