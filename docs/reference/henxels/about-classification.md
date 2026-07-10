---
type: reference
about: concept
title: "Henxel: a doc's subject is classified (about)"
description: "The henxel constraining every docs/ page's about field to the seven-value ontological-subject enum — the territory axis, orthogonal to type's form axis."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Henxel: a doc's subject is classified (about)

This henxel governs `./docs/*` (recursively, the same scope and exceptions
as [Henxel: concept docs carry OKF frontmatter](concept-frontmatter.md)):
every page's `about` frontmatter value must be one of `person`,
`organization`, `place`, `thing`, `event`, `process` or `concept` — the
ontological SUBJECT axis of [the two-axis ontology](../../ontology.md),
orthogonal to `type`'s document-form axis.

The henxel's own rejection message carries the full decision tree — the
rejection IS the classification manual, so a small model (or a person)
gets the walk right there, no external lookup needed: happens as a
WHOLE? → `event`. Unfolding? → `process` (telic with `target_end`,
atelic without). Acts? → `person` or `organization`. Spatial? → `place`
or `thing`. Else → `concept`. [Wiki conventions](../../wiki-conventions.md)
carries the same tree with a worked examples table for day-to-day writing.

Its form-axis companion is
[Henxel: concept docs carry OKF frontmatter](concept-frontmatter.md). Back
to [Henxels contract reference](../../reference-henxels.md).
