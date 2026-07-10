---
type: reference
about: concept
title: "Spec: T2 vectors"
description: "Semantic recall — the normative char-based chunker, chunks.jsonl, the embedding record, the LanceDB layout, the detection ladder and RRF fusion."
tags: [spec]
timestamp: 2026-07-10T18:30:00Z
---

# Spec: T2 vectors

T2 adds semantic recall. The **chunker is normative** (byte-golden, both
engines identical): split at ATX headings (levels 1–3), pack paragraphs into
chunks of at most 3200 chars, overlap consecutive chunks by 320 chars, drop
empties; chunk ids are `{path}#{slug-path}~{n}`. Chunks land in
`t2/chunks.jsonl`; the embedding backend is recorded in `t2/embedding.json`
(kind, endpoint, model, dim, fingerprint); vectors live in a LanceDB table
whose *layout* is normative even though vector *content* is advisory.

Retrieval: `semantic` is cosine top-k deduped to documents; `auto` with T2
fresh is RRF fusion (k=60) of keyword and semantic; stale or off degrades to
keyword with `degraded_from`. A normative mock embedder (dim 16) makes
conformance deterministic.

This is the T2 rung of [the tiers](../../the-tiers.md), driven by the
[embedding detection](../../embedding-detection.md) ladder and surfaced through
[search modes](../../search-modes.md). Back to [Spec reference](../../reference-spec.md).
