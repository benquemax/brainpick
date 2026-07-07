---
type: Decision
title: "ADR: layered configuration, shared over local over env"
description: "Why configuration splits into a shared brainpick.toml and a gitignored brainpick.local.toml, layered under environment and flags, so personal endpoints never collide with shared policy."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: layered configuration, shared over local over env

**Context.** A single configuration file forces a choice between committing
personal model endpoints and tokens or not versioning shared policy at all.
Neither is acceptable in a repo multiple people and agents share.

**Decision.** Split configuration into `brainpick.toml` (shared, versioned
bundle policy) and `brainpick.local.toml` (machine-local endpoints and tokens,
gitignored, deep-merged over the shared file), then layer environment
(`BRAINPICK_*`) and CLI flags on top. Precedence, weakest to strongest, is
defaults, the shared file, the local file, env, then flags — see
[Config layering and precedence](../config/layering.md).

**Alternatives considered.** One config file; environment-only configuration.
Rejected — one file leaks personal endpoints into shared history, and env-only is
hostile to onboarding and review.

**Consequences.** [brainpick init](../cli/init.md) writes detected endpoints to
the local layer and gitignores it during [Onboarding](../../onboarding.md); an
unparseable local layer is warned about and ignored so the shared file still
applies. The rules are fixed by [Spec: configuration](../spec/config.md) and the
[Environment overrides](../config/env-overrides.md) page. Back to
[Architecture decision records](../../reference-adr.md).
