---
type: decision
about: process
title: "ADR: TDD and the pre-push regression armor"
description: "Why TDD is mandatory, every verification test joins the permanent suite, and the pre-push gate runs both engines plus e2e — tests define the feature set that must always work."
tags: [governance]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: TDD and the pre-push regression armor

**Context.** A dual-runtime product with a live UI has a large feature surface
that must keep working as it grows, and ad-hoc verification tends to evaporate the
moment it passes.

**Decision.** Make TDD mandatory — the failing test lands before the code — treat
every verification test as permanent suite mass, and gate every push on the full
regression armor: the Node, webui and end-to-end suites, with the Python suite
gating every commit. Tests define the feature set.

**Alternatives considered.** Test-after or manual verification; throwaway
verification scripts. Rejected — untested features rot silently across two engines,
and discarded verifications lose their protective value.

**Consequences.** The suite only grows, the push gate is slow but total, and
cross-engine parity is held by conformance running in both suites — see
[Henxel: the Python engine's tests pass](../henxels/tests-pass.md) and
[Henxel: the whole feature set works](../henxels/whole-feature-set.md). It keeps
[Runtime parity](../../runtime-parity.md) honest against [Spec: overview](../spec/overview.md),
and it is the second instrument of
[ADR: perfect UX and AX are fruits of great DX](dx-first.md). Back to
[Architecture decision records](../../reference-adr.md).
