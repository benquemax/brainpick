---
type: reference
about: thing
title: "brainpick token"
description: "Manage bearer tokens for agents — create (prints the secret once), list (never secrets) and revoke."
tags: [cli, spec]
timestamp: 2026-07-10T18:30:00Z
---

# brainpick token

`brainpick token` manages the bearer tokens agents use to reach a served brain.
Three subcommands, each taking `--root`:

- `create [--name NAME]` — mint a token; the secret prints exactly once.
- `list` — list tokens by id and name — never secrets.
- `revoke <id>` — revoke a token by id; it stops working immediately, even on a running server.

Tokens gate `/api/*` and `/mcp` on non-localhost binds; stdio MCP is never
gated. They are stored as salted scrypt hashes in [the auth file](../config/auth-file.md),
never in git. This is the agent half of [authentication](../../authentication.md);
the human half is [brainpick password](password.md). Back to [CLI reference](../../reference-cli.md).
