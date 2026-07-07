---
type: Reference
title: "Behaviour: the near-copy warning"
description: "The warn_about_similar_files behaviour — a nudge when a new file looks like a near-copy of a committed one, above a similarity threshold."
timestamp: 2026-07-08T00:00:00Z
---

# Behaviour: the near-copy warning

This behaviour (`settings.warn_about_similar_files.above: 0.85`) warns when a
new file looks like a near-copy of a committed one. A few paths are ignored on
purpose — the three shipped `SKILL.md` copies are kept byte-identical by a sync
script, not by hand.

It is a nudge, not a test — sibling to
[Behaviour: push is blocked until blessed](push-guard.md) and
[Behaviour: deletes are blocked until blessed](delete-guard.md). The shipped
skill it tolerates is part of [agent integrations](../../agent-integrations.md).
Back to [Henxels contract reference](../../reference-henxels.md).
