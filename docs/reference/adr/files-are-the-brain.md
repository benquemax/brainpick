---
type: decision
about: concept
title: "ADR: the files are the brain and compiled state is disposable"
description: "Why markdown plus frontmatter is the only source of truth and everything under .brainpick is disposable — the guarantee that deleting it loses nothing."
tags: [engine]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: the files are the brain and compiled state is disposable

**Context.** A brain could be stored as a database of record with markdown as an
export. Brainpick chose the opposite polarity: the files come first, and
everything computed from them is derived.

**Decision.** The files are the brain — markdown plus frontmatter is the only
source of truth, and every compiled artifact under `.brainpick/` is disposable
and reconstructible. `rm -rf .brainpick/` followed by a compile rebuilds
byte-identical normative artifacts, as the [Artifact spec](../../artifact-spec.md)
guarantees.

**Alternatives considered.** A database or index as the record of truth, with
files as a view; long-lived caches that must be invalidated carefully. Rejected —
derived state is bookkeeping agents should never tend, and disposability removes a
whole class of corruption and migration bugs.

**Consequences.** The [Compile pipeline](../../compile-pipeline.md) must be
deterministic and hash-incremental against the [Spec: manifest](../spec/manifest.md),
and the one thing that must survive deletion of `.brainpick/` — credentials —
lives outside it (see [Authentication](../../authentication.md)). It is the
substrate that makes [ADR: one spec, two native engines](one-spec-two-engines.md)
achievable, framed by [Spec: overview](../spec/overview.md). Back to
[Architecture decision records](../../reference-adr.md).
