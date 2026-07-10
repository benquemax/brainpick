---
type: reference
about: concept
title: "Behaviour: push is blocked until blessed"
description: "The confirm_before_push behaviour — pushing is Tom's call, blocked until henxels bless push."
tags: [henxels, governance]
timestamp: 2026-07-10T18:30:00Z
---

# Behaviour: push is blocked until blessed

This behaviour (`settings.confirm_before_push: true`) blocks a push until
`henxels bless push`. Pushing is Tom's call, always — staging and committing
verified work is fine, but the remote is a deliberate, blessed step.

It is a protection, not a test, sibling to
[Behaviour: deletes are blocked until blessed](delete-guard.md) and
[Behaviour: the near-copy warning](similar-files.md). The pre-push henxel it
runs alongside is [Henxel: the whole feature set works](whole-feature-set.md).
Back to [Henxels contract reference](../../reference-henxels.md).
