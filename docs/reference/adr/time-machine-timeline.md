---
type: decision
about: thing
title: "ADR: the Time Machine distills git history"
description: "Why time travel reads a single advisory timeline.json distilled from one git log, reconstructing any moment by filtering, rather than recompiling the brain at every commit."
tags: [ui]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: the Time Machine distills git history

**Context.** A brain kept in git has a past worth traveling, but replaying it must
not cost a full recompile per commit, and git history differs across clones.

**Decision.** Distill the bundle's git history into one advisory artifact,
`timeline.json`, from a single `git log` — never a per-commit recompile. Its
layout is normative but its content is advisory, and the UI reconstructs any
moment by filtering docs on their created and deleted dates against the current
edges. This is the [Time machine](../../time-machine.md).

**Alternatives considered.** Recompile the brain at each historical commit; make
the timeline byte-golden. Rejected — per-commit recompilation is prohibitively
expensive, and clone-dependent history can never be conformance-golden.

**Consequences.** Time travel composes with the morph, firing and camera
machinery the [Holographic brain](../../holographic-brain.md) already runs, and
echoes how [Live deltas](../../live-deltas.md) animate the present; a non-git
bundle simply has no timeline and the feature hides. The artifact is produced by
the [Compile pipeline](../../compile-pipeline.md) under the [Artifact spec](../../artifact-spec.md),
specified in [Spec: timeline](../spec/timeline.md) — a natural extension of
[ADR: the files are the brain and compiled state is disposable](files-are-the-brain.md).
Back to [Architecture decision records](../../reference-adr.md).
