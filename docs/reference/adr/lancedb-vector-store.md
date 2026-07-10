---
type: decision
about: concept
title: "ADR: LanceDB as the vector store"
description: "Why brainpick stores T2 vectors in LanceDB over sqlite-vec — one on-disk format both runtimes read — while BM25 keyword search deliberately stays out of it."
tags: [tier, engine]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: LanceDB as the vector store

**Context.** T2 needs a vector store that both the Python and Node engines can
write and read, or [ADR: one spec, two native engines](one-spec-two-engines.md)
breaks at the vector layer.

**Decision.** Use LanceDB. Its official Python and Node SDKs share one on-disk
format, so the dataset one engine writes the other reads — proven by a live
interop test in [Runtime parity](../../runtime-parity.md). BM25 keyword search
stays out of LanceDB, running in memory over the document substrate, so T1 search
never depends on the vector store.

**Alternatives considered.** sqlite-vec and other single-runtime stores; putting
keyword search in the vector DB too. Rejected — a store only one runtime reads
would fork the artifact, and coupling keyword search to vectors would make the
always-on tier depend on an optional one.

**Consequences.** LanceDB is an optional extra kept off the T1 path; the
embedding record from [Embedding detection](../../embedding-detection.md)
fingerprints the model so a change re-embeds cleanly, and either engine can search
vectors it did not compile. The layout is fixed by [Spec: T2 vectors](../spec/t2-vectors.md),
gated by [modules.vectors](../config/modules-vectors.md), and surfaced through
[Search modes](../../search-modes.md). Back to [Architecture decision records](../../reference-adr.md).
