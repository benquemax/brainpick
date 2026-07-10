---
type: reference
about: concept
title: "Henxels contract reference"
description: "Each rule and behaviour in henxels.yaml — the structural contract that governs this repo — with what it checks and how to satisfy or consciously override it."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Henxels contract reference

`henxels.yaml` is the structural truth of this repository: each bullet is a
**henxel** (a rule), and the settings block adds **behaviours** (protections
and tuning knobs). To disobey a rule you change the contract — the only
sanctioned escape. Each page below documents one henxel or behaviour: what it
checks, why it exists, and how to satisfy it. This is the same referee the
[guarded writes](guarded-writes.md) path and the [compile pipeline](compile-pipeline.md)
run.

## Build-and-verify henxels

- [Henxel: the scratch folder survives](reference/henxels/scratch-folder.md)
- [Henxel: documented claims stay true](reference/henxels/docs-truth.md)
- [Henxel: the Python engine's tests pass](reference/henxels/tests-pass.md)
- [Henxel: the whole feature set works](reference/henxels/whole-feature-set.md)

## OKF-wiki henxels

- [Henxel: concept docs carry OKF frontmatter](reference/henxels/concept-frontmatter.md)
- [Henxel: a doc's subject is classified (about)](reference/henxels/about-classification.md)
- [Henxel: timestamp is bumped on change](reference/henxels/timestamp-bump.md)
- [Henxel: every link lands](reference/henxels/links-land.md)
- [Henxel: a concept is a node, not an orphan](reference/henxels/no-orphans.md)
- [Henxel: reserved files stay frontmatter-free](reference/henxels/reserved-frontmatter-free.md)
- [Henxel: update logs are date-sectioned](reference/henxels/log-sections.md)
- [Henxel: the bundle root has an index](reference/henxels/root-index.md)

## Behaviours

- [Behaviour: push is blocked until blessed](reference/henxels/push-guard.md)
- [Behaviour: deletes are blocked until blessed](reference/henxels/delete-guard.md)
- [Behaviour: the near-copy warning](reference/henxels/similar-files.md)

Back to [Reference](reference.md).
