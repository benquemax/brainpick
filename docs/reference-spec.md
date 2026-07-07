---
type: Reference
title: "Spec reference"
description: "The normative spec documents both engines honor — manifest, the three tiers, REST, live deltas, MCP, config, timeline and presentations — each summarized here."
timestamp: 2026-07-08T00:00:00Z
---

# Spec reference

The `spec/` tree is the runtime-neutral truth of brainpick: whatever both
engines must agree on lives there first. Each page below summarizes one spec
document's contract — what is normative, what is advisory, and which concept it
realizes. The spec underwrites [runtime parity](runtime-parity.md): one spec,
two engines, proven by conformance rather than hope.

## Foundations

- [Spec: overview](reference/spec/overview.md)
- [Spec: manifest](reference/spec/manifest.md)

## The tiers

- [Spec: T1 artifacts](reference/spec/t1-artifacts.md)
- [Spec: T2 vectors](reference/spec/t2-vectors.md)
- [Spec: T3 knowledge graph](reference/spec/t3-kg.md)

## Serving surface

- [Spec: REST API](reference/spec/rest-api.md)
- [Spec: live deltas](reference/spec/live-deltas.md)
- [Spec: MCP tools](reference/spec/mcp-tools.md)
- [Spec: presentations](reference/spec/presentations.md)

## Config and history

- [Spec: configuration](reference/spec/config.md)
- [Spec: timeline](reference/spec/timeline.md)

Everything here is the machinery behind the [artifact spec](artifact-spec.md)
and is written to the same [wiki conventions](wiki-conventions.md) this bundle
follows. Back to [Reference](reference.md).
