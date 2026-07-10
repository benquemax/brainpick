---
type: Reference
title: Authentication
description: Tokens for agents, a password for humans, and open-by-choice as a first-class setup — how a brain locks its door without ever committing a secret.
timestamp: 2026-07-10T00:00:00Z
---

# Authentication

A brain is open by default — [onboarding](onboarding.md) stays magic, and a
tokenless, passwordless localhost setup is a first-class citizen, not a
degraded one. Auth exists for the moment a brain leaves the laptop: it is
opt-in, and opting out again is as simple as revoking the last token and
clearing the password.

Two credentials, two audiences:

- **Tokens are for agents.** `brainpick token create` mints a `bp_…` secret
  and prints it exactly once; from then on every `/api/*` and `/mcp` request
  must carry `Authorization: Bearer <token>` (or a valid session). The live
  stream additionally accepts `?token=` because EventSource cannot set
  headers. `token list` shows ids and names — never secrets — and
  `token revoke <id>` bites immediately, even on a running server. Remote
  agents thus authenticate before they can read, and before
  [guarded writes](guarded-writes.md) are even attempted. stdio MCP is never
  gated: it is local by construction, spawned by the host that already owns
  the files.
- **The password is for humans.** `brainpick password set` puts a dark,
  self-contained login page in front of the web UI; `POST /api/login`
  exchanges the password for an HMAC-signed session cookie (12 hours,
  `HttpOnly`), and `/api/logout` drops it. The same session also opens
  `/api/*`, so the UI keeps working once you are in.

The storage design follows two house principles. Secrets must survive
`rm -rf .brainpick/` — artifacts are disposable, credentials are not — and
they must never enter git. So everything lives in `.brainpick-auth.json` at
the bundle root: salted scrypt hashes only (N=16384, r=8, p=1, 32-byte keys,
16-byte salts — byte-identical across both engines), written atomically with
owner-only permissions, and every command that touches the file appends it to
the repo `.gitignore` itself. The plaintext token exists in exactly one place:
the terminal where it was created, at the moment it was created.

[The daemon](daemon.md) reuses exactly this machinery for provisioning: when
a daemon user gets access to a brain, it mints a token on that brain's own
`.brainpick-auth.json` — the same `token create`, the same storage, just
called by the daemon instead of a human at the CLI. The daemon's own control
API is a separate secret again (`brainpickd token`), gating `/daemon/*`
routes rather than any one brain's `/api`/`/mcp`.
