---
type: article
about: process
title: Compile pipeline
description: How brainpick compiles a bundle — staged, hash-incremental, cron-able and watchable, with a fast freshness check for commit gates.
tags: [tier, engine]
timestamp: 2026-07-10T18:30:00Z
---

# Compile pipeline

`brainpick compile` turns an OKF bundle into the artifacts defined by the
[artifact spec](artifact-spec.md). The pipeline is a fixed, ordered list of
stages, each owning one tier of [the tiers](the-tiers.md): T1 graph and
index, T2 chunk-and-embed, T3 entity extraction. Every stage reports whether
it is available (configuration, installed extras, reachable backends) and a
disabled stage degrades with an instruction, never an error.

Incrementality is manifest-driven: the pipeline scans the bundle, hashes
every file, and diffs against the manifest to get a change set — added,
modified, deleted, unchanged. Stages consume the change set, so an edit to
one concept re-embeds one document's chunks, not the corpus. The manifest is
written last, atomically; a killed compile just redoes work.

Three ways to run it:

- **One-shot** — `brainpick compile`, the cron-friendly form.
- **Watch** — `brainpick compile --watch` (and `brainpick serve` by default)
  watches the bundle, debounces bursts, recompiles incrementally, and feeds
  the [live deltas](live-deltas.md) channel so the UI updates in real time.
- **Check** — `brainpick compile --check-fresh` verifies freshness without
  writing: a hash comparison plus the generated-index fence stamp. It is
  designed to sit in a henxels `run_before_commit` gate, where a stale index
  becomes a one-line instruction (`run: brainpick compile`) instead of a
  mystery.

Alongside the T1 artifacts, when the bundle lives in a git repository the
pipeline distills its history into the advisory timeline that powers the
[time machine](time-machine.md) — one `git log`, never a per-commit recompile,
and a git failure just omits it.

T1 always runs and always succeeds on a readable bundle. A failing T2 or T3
stage marks its tier stale and moves on — the deterministic layers never wait
for a model. Validation composes the same way: when a henxels contract is
present, the pipeline runs it first and treats findings as compile warnings;
brainpick generates, henxels verifies, and the [guarded writes](guarded-writes.md)
path reuses exactly that referee.
