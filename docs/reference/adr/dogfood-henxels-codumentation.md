---
type: Decision
title: "ADR: dogfood henxels and codumentation from day one"
description: "Why brainpick governs its own repo with henxels and validates its own docs with codumentation from the first commit, and keeps its wiki as the live dogfood corpus."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: dogfood henxels and codumentation from day one

**Context.** Brainpick sits in a family with henxels (the format referee) and
codumentation (docs-truth), and a tool that does not eat its own dog food
discovers its bugs in a user's repository instead of its own.

**Decision.** Govern this repository with henxels and validate its documentation
with codumentation from day one, and keep the `docs/` wiki as both the product's
documentation and the dogfood corpus brainpick compiles, serves and visualizes.
The contract is the [Henxels contract reference](../../reference-henxels.md).

**Alternatives considered.** Build brainpick without governing itself; validate
docs by review. Rejected — ungoverned, the repo would drift from the very
contracts it sells, and sibling bugs would surface at a user's site rather than at
home.

**Consequences.** Documented claims are executable specifications checked before
every push (see [Henxel: documented claims stay true](../henxels/docs-truth.md)),
the wiki grows with the code as test mass under the [Wiki conventions](../../wiki-conventions.md),
and the [Guarded writes](../../guarded-writes.md) path and [Compile pipeline](../../compile-pipeline.md)
reuse the same referee. It is one instrument of
[ADR: perfect UX and AX are fruits of great DX](dx-first.md), reaching agents via
[Agent integrations](../../agent-integrations.md). Back to
[Architecture decision records](../../reference-adr.md).
