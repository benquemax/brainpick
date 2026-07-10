---
type: reference
about: concept
title: "Spec: timeline"
description: "The history dimension — timeline.json distilled from one git log, advisory in content but normative in layout, with normative reconstruction semantics."
tags: [spec]
timestamp: 2026-07-10T18:30:00Z
---

# Spec: timeline

`timeline.json` distills the bundle's git history into a form the UI can travel
through. It is **advisory in content** (git history differs across clones,
absent in a non-repo bundle) but its **layout is normative**. Generation is one
`git log` over the bundle path — never a per-commit recompile — mapped to
bundle-relative paths, filtered to knowledge docs, with renames recorded as a
delete plus an add.

The file carries `commits` (oldest first), a per-doc `docs` lifecycle, and a
`span` summary. Reconstructing a moment T is defined normatively: nodes whose
`created ≤ T` and not yet deleted, edges from the current graph whose endpoints
both exist at T (an honest, stated approximation). A git failure just omits the
file and the feature hides.

This powers the [time machine](../../time-machine.md); it is an advisory T1
artifact produced by the [compile pipeline](../../compile-pipeline.md).
Back to [Spec reference](../../reference-spec.md).
