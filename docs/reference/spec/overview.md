---
type: reference
about: concept
title: "Spec: overview"
description: "The spec's map of the whole system — the three tiers, what each needs, T1's mandatory determinism, and the disposability guarantee."
tags: [spec]
timestamp: 2026-07-10T18:30:00Z
---

# Spec: overview

The overview frames the whole system: brainpick compiles an OKF bundle into
tiered, disposable artifacts under `.brainpick/` and serves them over REST, MCP
and a web UI. It fixes the tier table — T1 (deterministic, no models), T2 (an
embedding model), T3 (an extraction LLM) — and the rule that **T1 MUST be
implemented by every engine and MUST NOT invoke any model**, while T2/T3
degrade to the tier below and say so via `degraded_from`.

Two guarantees anchor everything: **disposability** (`rm -rf .brainpick/` then
recompile reconstructs byte-identical normative artifacts) and the reserved
files `index.md` / `log.md` (scanned but frontmatter-free, except the root
index which may declare `okf_version`).

This is the map for [the tiers](../../the-tiers.md) and the
[artifact spec](../../artifact-spec.md); the mechanics land in
[Spec: manifest](manifest.md) and [Spec: T1 artifacts](t1-artifacts.md).
Back to [Spec reference](../../reference-spec.md).
