---
type: reference
about: thing
title: "brainpick password"
description: "Manage the web UI password — set it (TTY prompt or --stdin) or clear it to reopen the UI without a login."
tags: [cli, spec]
timestamp: 2026-07-10T18:30:00Z
---

# brainpick password

`brainpick password` manages the single password that guards the web UI. Two
subcommands, each taking `--root`:

- `set [--stdin]` — set the password (a TTY prompt, or read from stdin for pipes).
- `clear` — remove the password; the UI opens without a login again.

A set password puts a login page in front of `/`; `POST /api/login` exchanges
it for an HMAC-signed session cookie. Clearing it (and revoking the last token)
returns the brain to its open-by-default state. This is the human half of
[authentication](../../authentication.md); the agent half is
[brainpick token](token.md). Back to [CLI reference](../../reference-cli.md).
