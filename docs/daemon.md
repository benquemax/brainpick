---
type: Concept
title: The daemon
description: brainpickd — the service that owns every brain's git sync, supervision, deploy keys, LAN reachability and users behind one small control API; every face (desktop app, browser, CLI) is a thin client of it.
timestamp: 2026-07-10T06:00:00Z
---

# The daemon

`brainpickd` (`packages/desktop`) is the answer to "all magic in the
brainpick service; the GUI is a dumb UI layer using the backend." It owns
every brain a machine hosts — git sync, process supervision, deploy-key
generation, users — behind one small control API. The desktop app (later)
is a thin client of it; so is a browser on another machine, or a script. One
service, any face.

It is deliberately its own npm workspace member, not a subcommand of the
engine CLI — [runtime parity](runtime-parity.md)'s CLI-parity check compares
the pip and npm engines' own subcommands, and the daemon is neither.

## What it owns

- **The registry** (`~/.config/brainpick/brains.toml`) — one `[[brain]]`
  table per brain: `id`, `repo` (a git URL or a local path), `bundle_path`
  (the wiki's subdirectory within the repo, if not the repo root), `port`,
  `enabled`, `host` (default `127.0.0.1` — loopback-only; `0.0.0.0` opts a
  brain into the LAN, mirroring the engine's own `[serve] host`, spec/80).
  Hand-editable, canonically written, forgiving to load (a malformed entry
  is dropped, never fatal).
- **The Supervisor** — one `brainpick serve` child process per enabled
  brain (process isolation; the engine itself is unmodified). A crashed
  process restarts on a bounded exponential backoff; a brain that keeps
  crashing eventually gives up rather than spin forever. Removing or
  disabling a brain stops it for good.
- **Git sync** — a remote-repo brain is cloned into
  `~/.local/share/brainpick/brains/<id>` on add, then polled (default 60s):
  fetch + a fast-forward-only merge, via SYSTEM git — never a bundled git
  library. A diverged history (local commits the remote doesn't have — a
  [guarded write](guarded-writes.md), say) is reported, never force-reset:
  the daemon never destroys something a human just wrote. A successful pull
  needs no extra step — the supervised `serve --watch` process notices the
  changed files and recompiles + live-deltas on its own.
- **Deploy keys** — one ed25519 keypair per brain, in the daemon's data dir,
  file-permission 0600 — no OS keychain (Linux Secret Service is a desktop-
  environment lottery, and a read-only key for a repo already sitting
  decrypted on the same disk gains nothing from encryption at rest). The
  private key is a standard PKCS8 PEM; modern OpenSSH reads it directly via
  `ssh -i`, so there is no bespoke key format to maintain. The public key
  comes back as a paste-able `ssh-ed25519 AAAA…` line for the repo's forge.
- **Users** (`~/.config/brainpick/users.toml`, under the hood — no UI yet) —
  `id` (uuid), `name`, an optional password, and `brains` (a list of ids, or
  `"*"` for every brain). First run bootstraps one passwordless user
  `"local"` with `"*"` access. Per-brain access is provisioned via the
  engine's OWN [token machinery](authentication.md) — the daemon mints and
  revokes a bearer token on a brain's `.brainpick-auth.json`, tagged with
  the user's name; it never re-implements auth.
- **LAN reachability** — spec/80 requires a token once a brain binds beyond
  loopback, so a `host = "0.0.0.0"` brain gets one auto-provisioned for the
  default (`"*"`-access) user the moment it is added or resumed. The engine
  itself never retains the plaintext (only a hash), so the daemon caches the
  secret in its own config dir (`lan-tokens.toml`, never committed) — the
  ONE piece of state the control API needs to keep handing back a working
  `claude mcp add` snippet. Self-healing: if the cached token is revoked or
  the cache is lost, the next request mints a fresh one.

## The control API

Small on purpose — it gets extended deliberately, not organically:

| Endpoint | Does |
|---|---|
| `GET /daemon/health` | liveness + `version` (the app's compatibility check) |
| `GET /daemon/brains` | the registry, plus each brain's live process status |
| `POST /daemon/brains` | add a brain: clones it if remote, compiles it as the structural check, runs `henxels check` if a contract governs it — **teach, don't reject**: a brain is created once T1 compiles, and any henxels fix-list rides along in the response for the caller to act on |
| `DELETE /daemon/brains/{id}` | stop supervising and forget the brain (its clone is left on disk) |
| `GET /daemon/brains/{id}/status` | port, process status, `mcp_url` (built from `advertise_host` — best-effort primary non-loopback IPv4, override via config — ONLY for a LAN-bound brain; never an address it isn't actually bound to) alongside `mcp_url_local` (always loopback), a ready `claude mcp add` snippet (carrying the provisioned bearer token for a LAN-bound brain), and — when the brain answers — its own `/api/status` |
| `POST /daemon/keys` | mint (or return the existing) deploy key for a brain id; omit `id` and it mints a FRESH brain id too, returned alongside the key — lets a private-repo wizard generate the deploy key (to paste into the forge) before the brain is registered |

Every route needs `Authorization: Bearer <daemon token>` — a single secret
distinct from any brain's own tokens, generated on first run and shown by
`brainpickd token`. `brainpickd start` (or a bare `brainpickd`) runs
everything; it resumes supervising every enabled brain already in the
registry, so a restarted daemon never loses what was running before it went
down.

## Where it fits

The daemon is a peer of the two engines — [runtime parity](runtime-parity.md)
is pip vs. npm; the daemon sits ABOVE either engine, spawning `brainpick
serve` as a child process it never modifies. A future desktop app (Tauri) is
a window hosting the daemon's own web UI plus first-run bootstrap; a browser
on another machine on the LAN drives the exact same control API.
