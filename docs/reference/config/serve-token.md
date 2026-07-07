---
type: Reference
title: "serve.token"
description: "A bootstrap bearer token required for non-localhost binds — default empty, superseded by real tokens once any exist."
timestamp: 2026-07-08T00:00:00Z
---

# serve.token

`token` under `[serve]` is a bootstrap bearer token for non-localhost binds.
Default empty. It is a stopgap: a non-localhost bind demands *some* credential,
and this key provides one until you mint real tokens with
[brainpick token](../cli/token.md), which supersede it. It carries a secret, so
it belongs in the machine-local layer (see
[Config layering and precedence](layering.md)), never the shared file.

Real credentials live hashed in [the auth file](auth-file.md); the whole model
is [authentication](../../authentication.md). Back to [Configuration reference](../../reference-config.md).
