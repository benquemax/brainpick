---
type: Concept
title: Artifact spec
description: Everything under .brainpick/ is a documented, runtime-neutral format — the contract that lets the pip and npm engines read the same compiled brain.
timestamp: 2026-07-02T00:00:00Z
---

# Artifact spec

The compiled brain — everything under `.brainpick/` — is not an
implementation detail. It is a documented, runtime-neutral format, and it is
the contract that makes "one spec, many runtimes" true: the Python engine and
the Node engine are independent implementations that must produce and consume
these artifacts identically, proven by shared conformance fixtures.

Artifacts are either **normative** (byte-golden-tested across both engines)
or **advisory** (schema'd but implementation-defined). The root of trust is
`manifest.json`: the spec version, a monotonic compile counter `seq`, a
SHA-256 map of every bundle file, and per-tier freshness. Incremental
compilation is a hash-diff against that map — no mtimes, no guesswork.

Canonicalization rules make cross-runtime byte-equality achievable: UTF-8,
LF, trailing newline, JSON with lexicographically sorted keys, POSIX
bundle-relative paths, ISO 8601 UTC timestamps, JSONL sorted by primary key.

The layout by tier (see [the tiers](the-tiers.md)):

- `t1/graph.json` and `t1/docs.jsonl` are normative — the link graph and the
  per-document substrate that search and reading stand on. `t1/layout.json`
  (2D cosmos positions, 3D brain positions, communities) and
  `t1/timeline.json` are advisory.
- `t2/chunks.jsonl` is normative (the chunker is specified, char-based, so
  both runtimes chunk bit-identically); the LanceDB dataset holds the
  vectors; `t2/embedding.json` fingerprints the embedding model so a model
  change invalidates vectors automatically.
- `t3/entities.jsonl` and `t3/relations.jsonl` are the normative **neutral
  export** of the [knowledge graph tier](knowledge-graph-tier.md); the
  LightRAG working directory next to them is private to the Python engine.

One artifact is written *into* the bundle rather than under `.brainpick/`:
the generated `index.md`, fenced between `<!-- brainpick:begin index -->`
markers with a content hash, produced by the
[compile pipeline](compile-pipeline.md) and independently refereed by the
henxels contract.

Disposability is a principle, not an accident: `rm -rf .brainpick/` followed
by `brainpick compile` must always reconstruct everything.
