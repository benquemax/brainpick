---
type: Reference
title: "The auth file"
description: "Where credentials live — .brainpick-auth.json at the bundle root, salted scrypt hashes only, gitignored, surviving rm -rf .brainpick/."
timestamp: 2026-07-08T00:00:00Z
---

# The auth file

Credentials never live in config or under `.brainpick/` — artifacts are
disposable and henxels hunts secrets. They live in `.brainpick-auth.json` at
the bundle root: salted scrypt hashes only (N=16384, r=8, p=1, 32-byte key,
16-byte salt, identical in both engines), holding the optional password, the
list of tokens, and a session secret. Every command that touches it appends the
file to `.gitignore`.

The enforcement trigger is *credentials existing*, not the file: revoke the
last token with no password and the brain reopens; a corrupt file fails closed.
It is written by [brainpick token](../cli/token.md) and
[brainpick password](../cli/password.md), and it is the storage half of
[authentication](../../authentication.md). Back to [Configuration reference](../../reference-config.md).
