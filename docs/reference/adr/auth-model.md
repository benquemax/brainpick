---
type: decision
about: concept
title: "ADR: tokens for agents, a password for humans, open by default"
description: "Why a brain is open by default and adds two credentials only when it leaves the laptop — bearer tokens for agents, a session password for humans — with scrypt hashes that outlive the compiled artifacts."
tags: [auth, governance]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: tokens for agents, a password for humans, open by default

**Context.** [Onboarding](../../onboarding.md) must feel like magic, so a
tokenless, passwordless localhost brain has to be first-class — but a brain that
leaves the laptop needs a door.

**Decision.** Stay open by default and make auth opt-in, with two credentials for
two audiences: bearer tokens for agents (`Authorization: Bearer`, plus `?token=`
for the event stream) and a password exchanged for an HMAC session cookie for
humans. Store only salted scrypt hashes in `.brainpick-auth.json`, byte-identical
across engines. The whole model is [Authentication](../../authentication.md).

**Alternatives considered.** Always-on auth; a single shared credential for both
audiences. Rejected — always-on kills the first wow, and one credential cannot
serve both a headless agent and a browser login cleanly.

**Consequences.** Credentials live outside `.brainpick/` (see
[The auth file](../config/auth-file.md)) so they survive its deletion; every
command that touches the file gitignores it; and stdio MCP is never gated because
it is local by construction. Tokens gate [Guarded writes](../../guarded-writes.md)
off localhost via [serve.token](../config/serve-token.md), minted by
[brainpick token](../cli/token.md) and cleared by [brainpick password](../cli/password.md).
Back to [Architecture decision records](../../reference-adr.md).
