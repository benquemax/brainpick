---
type: reference
about: concept
title: "Behaviour: deletes are blocked until blessed"
description: "The confirm_before_deleting behaviour — losing files or many lines must be deliberate, blocked until henxels bless delete."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Behaviour: deletes are blocked until blessed

This behaviour (`settings.confirm_before_deleting.over_lines: 5`) blocks
deleting files or removing more than a few lines until `henxels bless delete`.
Losing files or many lines must be deliberate, not an accident of a large edit.

It is a protection sibling to
[Behaviour: push is blocked until blessed](push-guard.md) and
[Behaviour: the near-copy warning](similar-files.md). Back to [Henxels contract reference](../../reference-henxels.md).
