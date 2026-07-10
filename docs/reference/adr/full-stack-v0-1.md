---
type: decision
about: concept
title: "ADR: ship the full stack in one v0.1 release"
description: "Why brainpick builds T1 through T3, MCP, CLI and the live UI as one v0.1 release before any publish, rather than shipping a thin slice first."
tags: [governance]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: ship the full stack in one v0.1 release

**Context.** Brainpick fills the whole missing layer between a folder of valid
markdown and a brain an agent can actually pick — indexes, vectors, an entity
graph, servers, and a way for humans to see it. A thin first slice would demo
none of that movie scene.

**Decision.** v0.1 is the full stack in one release: all of [The tiers](../../the-tiers.md)
(T1 through T3), MCP and CLI, guarded writes, and the [Holographic brain](../../holographic-brain.md)
plus cosmos PWA — landed across three milestones (Ensilento, Kaksoisveto,
Hologrammi) before anything publishes to PyPI or npm. The package names are
reserved, not yet claimed.

**Alternatives considered.** Publish T1 alone and iterate in the open; ship the
engine first and the UI later. Rejected — the first wow is the living graph, and
a half-stack undersells the north star while spending the one-time name claim on
an incomplete product.

**Consequences.** A longer road to first publish, but a coherent product at
launch: every tier and both the agent and human faces exist from the first tag.
Publishing stays a deliberate, held step. The scope is only reachable because
[Runtime parity](../../runtime-parity.md) and [Onboarding](../../onboarding.md)
are built in from the start. Back to [Architecture decision records](../../reference-adr.md).
