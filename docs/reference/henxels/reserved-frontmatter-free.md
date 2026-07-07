---
type: Reference
title: "Henxel: reserved files stay frontmatter-free"
description: "The henxel that OKF reserved files — index.md and log.md — carry no frontmatter, except the bundle root index which may declare okf_version."
timestamp: 2026-07-08T00:00:00Z
---

# Henxel: reserved files stay frontmatter-free

This henxel keeps the OKF reserved files frontmatter-free: any `index.md` or
`log.md` at any depth must carry no YAML frontmatter block (`no_frontmatter:
true`), with a single exception — the bundle root `docs/index.md`, which may
declare `okf_version`. This is why no reference page is named `index.md`: such a
name would demand emptiness where a `type: Reference` header is needed.

It sits beside [Henxel: the bundle root has an index](root-index.md) and
[Henxel: update logs are date-sectioned](log-sections.md) as the reserved-file
rules. Back to [Henxels contract reference](../../reference-henxels.md).
