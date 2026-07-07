---
type: Reference
title: "Henxel: update logs are date-sectioned"
description: "The custom henxel that a log.md is organized into date headings, newest first."
timestamp: 2026-07-08T00:00:00Z
---

# Henxel: update logs are date-sectioned

This henxel requires every `log.md` to be organized into date headings, newest
first (`log_headings_are_dates: true`, a custom check living in
`henxels_checks.py`). It is why this bundle's update log grows by prepending a
dated section, not by scattering entries.

It is a reserved-file rule alongside
[Henxel: reserved files stay frontmatter-free](reserved-frontmatter-free.md);
the log it governs records changes to the concepts in this
[Reference](../../reference.md). Back to [Henxels contract reference](../../reference-henxels.md).
