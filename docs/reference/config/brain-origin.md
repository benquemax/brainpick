---
type: reference
about: thing
title: "brain.origin"
description: "The canonical git URL of a brain — how other people find and clone it; a lookup key for the federation registry, never the brain's identity, which is bundle.id."
tags: [config, spec, brain-format]
timestamp: 2026-09-07T11:30:00Z
---

# brain.origin

`origin` under `[brain]` is the canonical git URL of this brain — the address a
person or a registry uses to *find* it. Default `""`. It is deliberately not the
brain's identity: git URLs move when forges rename, and cross-brain links must
survive that, so identity is [bundle.id](bundle-id.md) and `origin` is the
lookup that maps an id to a clone. Physical paths are never a brain's address —
they differ per person and per clone convention.

Env override: `BRAINPICK_BRAIN_ORIGIN`. The addressing model, with the
`brain://slug-id/path` link syntax, is [Brain subsidiarity](../../brain-subsidiarity.md);
the registry that will resolve it is [Federation](../../federation.md).

Back to [Configuration reference](../../reference-config.md).
