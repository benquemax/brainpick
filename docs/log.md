# Update log

## 2026-07-10

- Added: `.github/workflows/desktop-release.yml` — a `desktop-v*` tag builds the AppImage/dmg/msi trio (plus a standalone headless `brainpickd-<platform>.tar.gz` per platform) across a 3-OS matrix and attaches them to a draft GitHub Release; a one-line guard keeps the tag and `packages/desktop/app/package.json` in lockstep independently of the engines' own `v*` releases.
- Added: a locally-proven single-file desktop installer — `stage-resources.mjs` bundles a checksum-verified Node runtime and a real production `node_modules` (with ~650MB of unused onnxruntime-node GPU providers and foreign platforms pruned) into Tauri resources; a clean-shell `.AppImage` run (no repo, no Node, no Rust on PATH) boots the daemon from those resources, adds a brain, and answers a real MCP handshake.
- Added: the desktop app's brain cards now show the plain browser URL (copy button + "Open brain") alongside the MCP snippet; fixed a trailing-slash local-path bug (e.g. `/tmp/brain-test/`) that produced a doubled slash downstream — normalized once at the registry validation boundary.
- Added: the desktop app — a Tauri v2 window over the daemon's control API (first-run bootstrap, an add-brain wizard with deploy-key + forge-deep-link flow, a brain list with MCP-snippet copy, a tray icon) with no logic of its own, everything an API call.
- Fixed: the control API now sends CORS headers, and `henxels check --all` runs with a bounded timeout so a hung install can't wedge the whole daemon.
- Added: the daemon's LAN story — a per-brain `host` (default loopback, `0.0.0.0` opts in), auto-provisioned bearer tokens for LAN-bound brains, an `advertise_host`-built `mcp_url` alongside an always-loopback `mcp_url_local`, and a `POST /daemon/keys` that can mint a brain id up front for the private-repo wizard flow.
- Added: `brainpickd` — the daemon (`packages/desktop`) that owns git sync, process supervision, ed25519 deploy keys and users behind a small token-authed control API; the desktop app and any other face become thin clients of it.
- Added: the Node engine embeds locally too — `@huggingface/transformers` on onnxruntime-node (optionalDependency, `kind = "local"`, default `nomic-ai/nomic-embed-text-v1.5`) cuts the Ollama dependency for a Python-free desktop daemon; Ollama remains a supported rung when reachable.
- Added: `[bundle] id` — a stable brain identity minted by `brainpick init` and shipped via `GET /api/status`, for multi-brain serving and future MCP routing.
- Changed: the knowledge graph is now derived algorithmically by default — ghosts and tags become entities, no model needed; LLM extraction stays opt-in.

## 2026-07-08

- Polished: precise hover picking, connections light up on hover, calmer idle glow, steadier labels, and hubs sized by how connected they are.
- Added: architecture decision records — the founding decisions, one interlinked ADR per call, closing the reference volume layer.
- Added: the reference volume layer — CLI, config, spec, MCP and henxels reference pages, richly interlinked (the wiki now stresses the UI at scale).
- Added: the UI renders agent presentations — brain_show spotlights nodes, flies the camera, and captions them live.
- Added: brain_show — an agent can spotlight a subgraph and caption it live in every open UI (MCP tool + POST /api/show + brain.show event).

## 2026-07-07

- Polished: labels and search-flight now work inside the hologram, entity panels show their source docs, and the operator's [ui] node cap reaches the client.
- Parity: the Node engine now proposes three-way (and LLM) merges on a stale write, matching Python's conflict response.
- Added: the in-browser WYSIWYG editor — write formatted pages on any device, photos and title-linked references included, saved through the guarded write path.
- Added: guarded REST writes (PUT /api/docs) + image upload (POST /api/assets) — the engine half of the in-browser editor, reusing brain_write's referee + merge.
- Improved: entity payloads carry source_docs, tiers.t3 resets honestly, and [ui] config reaches the client via /api/status.

## 2026-07-06

- Added: the Time Machine — scrub through the brain's git history and watch it grow; the flat cosmos and the hologram both travel through time.
- Added: timeline.json — the brain's git history distilled for the coming Time Machine (advisory T1 artifact; /api/timeline serves it).

## 2026-07-04

- Fixed: returning from brain to cosmos restores the flat camera cleanly — no more horizontal stretch, and clicking a dot opens its article again.
- Updated: the brain fills its volume — nodes spread through the 3D form (no more flat-sheet look) and it turns slowly on its axis like a galaxy.
- Updated: the hologram got its anatomy and its manners — the form reads as a real brain (elongated front-to-back, tapered occipital, temporal lobes, a subtle top fissure — no more two-cheeks look); clicking a dot in the 3D brain opens its article again; the return to the flat cosmos eases instead of snapping; and a cosmos drag pans straight.
- Updated: the brain is real — the cosmos morphs into a floating holographic brain, procedural SDF form, topic clusters gathered into lobes, spun and pinched with your fingers.
- Updated: T3 extraction landed — LightRAG behind the KGBackend adapter turns the
  prose into an entity graph, normalized into the neutral export; Python extracts,
  both engines read.
- Updated: T3 query is live in both engines — entity-layer neighbors, mode=graph
  search, and the entity graph over the API, all reading the neutral export.
- Updated: the cosmos now fits the phone — GPU-tier node budgets with
  degree-ranked culling and per-directory cluster aggregation, honest
  'showing N of M' when it caps.
- Created: brainpick meets agents where they live — a skill, one-command
  integrations, and a brain report that teaches graph-before-grep.
- Created: the brain learned to lock its door — tokens for agents, a password
  for humans, and open-by-choice stays first-class.
- Updated: the cosmos gained a NAVIGATOR — a live directory tree for when you
  know exactly what you are looking for, desktop panel and mobile drawer
  alike.
- Updated: the cosmos can see the second layer — toggle to the extracted entity graph or overlay it on the links, distinct hues, click an entity to reach its sources.

## 2026-07-03

- Updated: full engine parity — the Node engine now serves too: REST, live
  SSE, the same UI, and MCP with guarded writes; pick your runtime, the brain
  is identical.
- Updated: writes learned optimistic concurrency — stale saves are detected by
  content hash and resolved by a merge ladder that ends in the brain's own
  model proposing the merge.
- Updated: the cosmos got its game HUD — search modes (keyword/semantic/auto)
  in the UI, lenses, camera bookmarks, calmer glow.
- Updated: the Node engine reached T2 — same chunks, same vectors, same hybrid
  search; the conformance suite now passes both engines with zero skips.
- Created: the native Node engine's T1 compiler — byte-identical artifacts,
  proven by the shared conformance suite; the npm side needs no Python.
- Updated: T2 landed in the Python engine — deterministic chunking, LanceDB
  vectors, the embedding ladder, and hybrid semantic search behind the same
  one search tool.
- Updated: onboarding landed — brainpick init detects the bundle and local
  models, writes config, compiles, and hands out MCP snippets; doctor
  diagnoses; Playwright now exercises the real server end to end.
- Updated: the Python engine learned to serve — REST, live SSE deltas, the web
  UI, and MCP over stdio and streamable HTTP, with guarded writes.

## 2026-07-02

- Created: the web UI workspace — 2D cosmos, live deltas, search, PWA shell.
- Updated: the wiki is now compiled by brainpick itself — spec v0.1 (manifest,
  T1 artifacts, REST, live deltas, MCP tools, config), the kotiaurinko
  conformance fixture, and the Python T1 engine landed; the generated index
  section below the preamble is its work.
- Created: seeded the wiki with the founding concept set — the tiers,
  artifact spec, compile pipeline, live deltas, MCP tools, search modes,
  guarded writes, runtime parity, knowledge graph tier, embedding detection,
  holographic brain, onboarding, and the wiki conventions.
