---
type: Decision
title: "ADR: perfect UX and AX are fruits of great DX"
description: "Why brainpick invests first in developer experience — the artifact spec, TDD, conformance, the henxels contract and codumented docs — as the mechanism that keeps the agent and human surfaces perfect."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: perfect UX and AX are fruits of great DX

**Context.** Brainpick has two demanding surfaces — agents (AX) and humans (UX)
— and both must stay correct as the stack grows across two independent runtimes.
Polishing those surfaces directly does not stop them drifting underneath.

**Decision.** Treat developer experience as the cause and UX/AX as the fruit.
The [Artifact spec](../../artifact-spec.md), mandatory TDD, shared conformance
fixtures, the [Henxels contract reference](../../reference-henxels.md), and
codumented docs are the machinery that holds the outward surfaces perfect.

**Alternatives considered.** Optimize the UX and AX surfaces directly, adding
process only where pain appears. Rejected — surfaces drift without a spec-and-test
substrate, and the drift is invisible until a user hits it, especially across two
engines kept honest only by [Runtime parity](../../runtime-parity.md).

**Consequences.** An up-front cost in specs and tests, paid back as durable
correctness. This umbrella decision is realized by two concrete ones —
[ADR: dogfood henxels and codumentation from day one](dogfood-henxels-codumentation.md)
and [ADR: TDD and the pre-push regression armor](tdd-regression-armor.md) — and
the bundle it produces follows the [Wiki conventions](../../wiki-conventions.md)
it documents. Back to [Architecture decision records](../../reference-adr.md).
