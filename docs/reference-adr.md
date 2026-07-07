---
type: Reference
title: "Architecture decision records"
description: "The founding and major decisions behind brainpick — one Architecture Decision Record per call, each with its context, alternatives and consequences, richly cross-linked."
timestamp: 2026-07-08T00:00:00Z
---

# Architecture decision records

This is brainpick's **decision volume**: one Architecture Decision Record (ADR)
per founding or major call, each derived from the repository's own vision,
principles and milestone history — never invented after the fact. Where the
concept docs explain *how* a mechanism works and the [Reference](reference.md)
volume pins down *exactly what*, these pages record *why brainpick chose it*,
what it weighed against, and what the choice costs. Each page carries
`type: Decision` — the [wiki conventions](wiki-conventions.md)' ADR-style record.

## Scope and philosophy

- [ADR: ship the full stack in one v0.1 release](reference/adr/full-stack-v0-1.md)
- [ADR: small models are first-class citizens](reference/adr/small-models-first-class.md)
- [ADR: perfect UX and AX are fruits of great DX](reference/adr/dx-first.md)
- [ADR: the files are the brain and compiled state is disposable](reference/adr/files-are-the-brain.md)

## Architecture and runtime

- [ADR: one spec, two native engines](reference/adr/one-spec-two-engines.md)
- [ADR: LanceDB as the vector store](reference/adr/lancedb-vector-store.md)
- [ADR: LightRAG behind the KGBackend adapter](reference/adr/kgbackend-adapter.md)
- [ADR: layered configuration, shared over local over env](reference/adr/config-layering.md)

## Writes, concurrency and auth

- [ADR: guarded writes from day one](reference/adr/guarded-writes-day-one.md)
- [ADR: optimistic concurrency and the merge ladder](reference/adr/optimistic-concurrency-merge-ladder.md)
- [ADR: tokens for agents, a password for humans, open by default](reference/adr/auth-model.md)
- [ADR: the WYSIWYG editor on ProseMirror](reference/adr/wysiwyg-prosemirror-editor.md)

## The live human face

- [ADR: the holographic brain and cosmos UI](reference/adr/holographic-brain-ui.md)
- [ADR: whole-graph deltas over SSE](reference/adr/whole-graph-deltas-sse.md)
- [ADR: the Time Machine distills git history](reference/adr/time-machine-timeline.md)
- [ADR: brain_show, agent-driven presentations](reference/adr/brain-show-presentations.md)

## Governance and the agent surface

- [ADR: dogfood henxels and codumentation from day one](reference/adr/dogfood-henxels-codumentation.md)
- [ADR: TDD and the pre-push regression armor](reference/adr/tdd-regression-armor.md)
- [ADR: agent-agnostic, AGENTS.md is the one agent doc](reference/adr/agent-agnostic.md)

These records close the reference volume layer the [Reference](reference.md) hub
opens, and they follow the [wiki conventions](wiki-conventions.md) the whole
bundle obeys. Back to [Reference](reference.md).
