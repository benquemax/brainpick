---
type: reference
about: concept
title: "Henxel: concept docs carry OKF frontmatter"
description: "The henxel requiring every docs/ concept to be kebab-case markdown with type/about/title/description frontmatter, type from the five-value form enum."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Henxel: concept docs carry OKF frontmatter

This henxel governs `./docs/*` (recursively): every concept doc must be
kebab-case markdown carrying OKF frontmatter — `type`, `about`, `title`,
`description` — with `type` one of `article` (default), `decision`,
`playbook`, `reference` or `log`. `type` is a page's document FORM, one
axis of [the two-axis ontology](../../ontology.md); its sibling henxel,
[Henxel: a doc's subject is classified (about)](about-classification.md),
constrains the orthogonal SUBJECT axis. One concept per page; the
description feeds the generated index and the graph UI. A handful of
reserved paths are excepted.

It is the frontmatter rule this whole [Reference](../../reference.md) volume
obeys (`type: reference` on every page) and the shape described in
[wiki conventions](../../wiki-conventions.md). Its date companion is
[Henxel: timestamp is bumped on change](timestamp-bump.md). Back to [Henxels contract reference](../../reference-henxels.md).
