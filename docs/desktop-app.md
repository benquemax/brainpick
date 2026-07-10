---
type: Concept
title: The desktop app
description: A Tauri v2 window over the daemon's control API — first-run bootstrap, an add-brain wizard, and a tray icon; no business logic lives in the app, only in brainpickd.
timestamp: 2026-07-10T16:15:00Z
---

# The desktop app

`packages/desktop/app` is a Tauri v2 shell around [the daemon](daemon.md)'s
control API — nothing more. The rule that shaped every line of it: **no
logic in the app that isn't an API call**. Every decision — what a brain's
status is, whether a repo needs a deploy key, what the henxels fix-list
says — is computed by `brainpickd`; the app only renders the response and
issues the next call.

## First-run bootstrap

On launch, the Rust side (`src-tauri/src/daemon.rs`) mirrors the daemon's
own config-dir resolution exactly (`BRAINPICK_DAEMON_CONFIG_DIR` >
`XDG_CONFIG_HOME` > `~/.config`, joined with `brainpick`) so it reads the
same token file the daemon writes. It probes `GET /daemon/health`; if
nothing answers, it spawns `brainpickd start` itself and polls until
healthy or a 20s timeout. The webview never spawns anything — it calls the
`daemon_info` Tauri command and gets back a base URL and token, then talks
to the control API exactly like a browser would.

## The add-brain wizard

A repo URL or local path, an optional bundle subdirectory, and an LAN-access
checkbox. A local path calls `POST /daemon/brains` directly; a remote repo
calls `POST /daemon/keys` first (no `id` — the daemon mints one), shows the
pasteable deploy key with a forge deep-link when the host is recognized
(github.com, gitlab.com or self-hosted), then registers the brain once the
key step is confirmed. The result step shows the compiled bundle kind and
doc count, and any henxels fix-list verbatim — teach, don't reject, same as
the API itself.

## Brain list and tray

The main window lists every registered brain with its live process status;
revealing a card's details lazily fetches `GET /daemon/brains/:id/status`
and shows both the ready `claude mcp add` command (bearer token included
for a LAN-bound brain) and the plain browser URL — `mcp_url` minus `/mcp`,
a presentation-only transform of a value the daemon already computed —
each with its own copy button, plus an "Open brain" button that hands the
local URL to the system's default browser via the `opener` plugin. The
tray icon polls the same status endpoint every 10s and reflects overall
status in its tooltip — open or quit, nothing else.

## Why a browser-shaped webview needs CORS

The control API's only clients are webviews and browsers — different
origins from its own port by construction. `brainpickd` answers every
`/daemon/*` request with `Access-Control-Allow-Origin: *` and handles the
preflight `OPTIONS` request before the token check ever runs (a preflight
never carries the real `Authorization` header). The bearer token remains
the actual gate; origin is not treated as identity.

## Packaging: no installed Node anywhere

A tester's machine has neither Rust nor Node — the single-file installer
carries its own runtime (the Packaging appendix,
`_plans/2026-07-09-algorithmic-brain-phase1.md`). `scripts/stage-resources.mjs`
assembles `src-tauri/resources/` before Tauri's own bundler ever runs
(wired into `beforeBuildCommand`, so a bare `npm run tauri build` is the
whole pipeline):

- **`resources/node/`** — the official Node dist archive for the target
  platform, downloaded and checked against nodejs.org's own
  `SHASUMS256.txt` before anything trusts it. Node's own archives disagree
  on layout: `bin/node` on Linux/macOS, a flat `node.exe` on Windows — the
  Rust resolver (`daemon.rs`) checks both.
- **`resources/daemon/`** — `packages/desktop/dist` copied flat, plus a
  REAL (non-symlinked) `node_modules` for it and the engine. Getting a real
  copy out of an npm workspace needs `--install-links` (npm symlinks local
  directory paths by default, same as a workspace) and an explicit local
  path for `brainpick` in the same install call — it isn't published, so
  the registry 404s on it otherwise.
- **Pruned before anyone ships it**: `onnxruntime-node` (a transitive
  dependency of the local-embedding backend) bundles EVERY platform's
  native binaries in one package regardless of which platform installed
  it, including 500MB+ of CUDA/TensorRT datacenter-GPU provider libraries
  this CPU-only embedding path never loads. Both the foreign platform
  directories and the GPU providers are deleted post-install — roughly
  650MB off a single staged tree, empirically.
- Native optional deps (`@lancedb`, the pruned `onnxruntime-node`) can only
  ever be correct for whatever platform actually RAN `npm install` — the
  three-OS CI matrix (Phase 1.5-B) stages each target on its own runner;
  cross-staging from one OS to build another's resources isn't possible
  for the native pieces, only for the explicitly-downloaded Node binary.
