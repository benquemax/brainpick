---
type: reference
about: concept
title: "Spec: configuration"
description: "The configuration contract — one TOML file, shared vs machine-local layering, precedence, the auth storage design and the model sections."
tags: [spec]
timestamp: 2026-07-10T18:30:00Z
---

# Spec: configuration

The config spec fixes brainpick.toml: one file at the bundle root, identical
semantics in both engines, absent file meaning all defaults. It defines the
**layering** — shared `brainpick.toml` under machine-local `brainpick.local.toml`
under env (`BRAINPICK_*`) under CLI flags — and the rule that unknown keys warn
rather than error, so a newer brainpick's config never bricks an older one.

It also specifies auth storage (`.brainpick-auth.json`, salted scrypt, never in
git, failing closed when corrupt) and the model sections `[models.embedding]`
and `[models.extraction]` — the extraction model powering T3 and doubling as
the brain_write merge resolver.

Every key has a page under the [Configuration reference](../../reference-config.md);
the auth model is [authentication](../../authentication.md). Back to [Spec reference](../../reference-spec.md).
