---
type: decision
about: concept
title: "ADR: one spec, two native engines"
description: "Why brainpick ships native Python and Node engines that never require each other, kept honest by a shared conformance harness instead of a single implementation with a thin client."
tags: [engine, governance]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: one spec, two native engines

**Context.** Agents live in both the Python and Node ecosystems. Requiring
Python of npm users (or Node of pip users) would exclude half of them, and the
compiled brain is what they must share.

**Decision.** Everything under `.brainpick/` is a documented, runtime-neutral
[Artifact spec](../../artifact-spec.md), and `pip` and `npm` are native peers —
the npm package contains no Python and never shells out to one. Shared
conformance fixtures, not hope, keep them byte-identical, as [Runtime parity](../../runtime-parity.md)
records.

**Alternatives considered.** One Python package with a thin JavaScript client; a
Node wrapper that shells out to Python. Rejected — Tom was explicit that npm must
never require Python, and a wrapper is not a native peer.

**Consequences.** Some heavy compilation — T3 entity extraction — is anchored to
the Python ecosystem, so the Node engine delegates that one step or skips it
instructively while still querying the artifacts natively. Every shared behavior
must be proven by the harness. It rests on
[ADR: the files are the brain and compiled state is disposable](files-are-the-brain.md)
and is detailed in [Spec: overview](../spec/overview.md) and the [Spec reference](../../reference-spec.md).
Back to [Architecture decision records](../../reference-adr.md).
