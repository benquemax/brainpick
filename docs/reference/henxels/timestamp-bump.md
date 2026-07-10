---
type: reference
about: concept
title: "Henxel: timestamp is bumped on change"
description: "The henxel requiring a real ISO 8601 datetime timestamp that is bumped whenever a doc changes."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Henxel: timestamp is bumped on change

This henxel requires each concept doc's `timestamp` to be a real ISO 8601
datetime, and to be **bumped whenever the doc's content changes**
(`frontmatter_dates: timestamp=datetime`, `bump_updated_on_change: timestamp`).
The bump check is a history rule: it fires on a staged edit to a tracked file,
so a new file has nothing to bump.

It is the date companion of
[Henxel: concept docs carry OKF frontmatter](concept-frontmatter.md), and the
freshness it protects is what the [compile pipeline](../../compile-pipeline.md)
reads. Back to [Henxels contract reference](../../reference-henxels.md).
