---
type: reference
about: thing
title: "serve.host"
description: "The bind host for brainpick serve — default 127.0.0.1; a non-localhost bind requires a token."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# serve.host

`host` under `[serve]` is the address [brainpick serve](../cli/serve.md) binds.
Default `127.0.0.1` — localhost only, open by default. Bind `0.0.0.0` or a LAN
address to share the brain, and auth stops being optional: a non-localhost bind
demands a [serve.token](serve-token.md) (or real tokens once any exist).

The CLI `--host` flag overrides this key. It pairs with
[serve.port](serve-port.md); the enforcement rules are
[authentication](../../authentication.md). Back to [Configuration reference](../../reference-config.md).
