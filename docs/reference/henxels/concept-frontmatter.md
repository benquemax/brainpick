---
type: Reference
title: "Henxel: concept docs carry OKF frontmatter"
description: "The henxel requiring every docs/ concept to be kebab-case markdown with type/title/description frontmatter, type from the allowed set — the one MUST is type."
timestamp: 2026-07-08T00:00:00Z
---

# Henxel: concept docs carry OKF frontmatter

This henxel governs `./docs/*` (recursively): every concept doc must be
kebab-case markdown carrying OKF frontmatter — `type`, `title`, `description` —
with `type` one of Concept, Reference, Decision or Playbook. `type` is the one
MUST; one concept per page; the description feeds the generated index and the
graph UI. A handful of reserved paths are excepted.

It is the frontmatter rule this whole [Reference](../../reference.md) volume
obeys (`type: Reference` on every page) and the shape described in
[wiki conventions](../../wiki-conventions.md). Its date companion is
[Henxel: timestamp is bumped on change](timestamp-bump.md). Back to [Henxels contract reference](../../reference-henxels.md).
