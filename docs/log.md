# Update log

## 2026-09-09

- Released 0.4.2: the write-guard fix below.
- Fixed: `brain_write` (and `PUT /api/docs`) silently skipped the henxels
  referee in the two most common real-world setups, accepting docs with no
  frontmatter and no links that the pre-commit hook would then reject.
  (a) The guard only looked for `henxels.yaml` at the bundle root, so a
  brain laid out as `henxels.yaml` beside `_brain/` (the template layout)
  counted as "no contract" — it now uses `detect_henxels` (bundle root, then
  repo root) and runs `henxels check` from the contract's directory with a
  contract-relative path. (b) It resolved the CLI with a bare PATH lookup,
  so a harness spawning `brainpick mcp` with `PATH=/usr/bin:/bin` hid a
  `uv tool install henxels` in `~/.local/bin` and the write went through
  with only a warning — `find_henxels` now falls back to `$XDG_BIN_HOME`,
  `~/.local/bin` and the Windows Python `Scripts` dirs. Both engines;
  regression tests for both cases; spec/70 and
  [guarded writes](guarded-writes.md) updated.

## 2026-09-08

- Released 0.4.1: the configurable embedding timeout below.
- Fixed: the embedding HTTP timeout was hardcoded at 120 s per batch in both
  engines, so a slow-but-alive backend (a shared LAN Ollama under load, a
  laptop CPU with no GPU) silently degraded T2 to keyword search on every
  compile. It is now `[models.embedding] timeout` (whole seconds per ≤64-text
  batch, default 1800, env `BRAINPICK_MODELS_EMBEDDING_TIMEOUT`); only a
  connection that cannot be opened still fails fast. Documented in
  [models.embedding](reference/config/models-embedding.md); spec/30 and
  spec/80 updated; `brainpick init` writes the key commented out into
  `brainpick.local.toml`.

## 2026-09-07

- Released 0.4.0: `brain_search`'s `why` now names the query tokens that
  actually matched (and where) instead of echoing the whole query (#2), and
  `brainpick integrate dsh` wires a brain into a DeepSeek Harness web profile
  by printing the `@deepseek-ai/dsh-mcp-client` cordis insert with the
  resolved absolute root (#3).
- Released 0.3.1 (the README ships in the PyPI package; this release
  carries the new one).
- Released 0.3.2: the README gained a five-minute spoken episode
  (`docs/assets/audio/brainpick-episode.mp3`, TTS from a committed
  transcript) served from Pages; the tag deploys it.
- Added: the hypothesis — a small model with frictionless access to
  knowledge and skills that evolve in real time becomes a self-improving
  agent that beats a large model without such access, at a fraction of the
  VRAM, compute and energy — and its sub-hypothesis: associations are made
  by the author at write time under the contract, the graph derived from
  them, never extracted retroactively (why LightRAG was retired). Stated in
  `_vision.md`, the README (codumented) and `docs/the-hypothesis.md`.
- Changed: the brain format's read path starts with `git pull` and its write
  path ends with a push (spec/85; henxels' first skill says so since 0.13.1).
- Docs: `docs/the-tiers.md` no longer advertises an opt-in LLM extractor.

- Added: the brain format (spec/85) — an opinionated OKF bundle for agent
  memory: folders as memory types, inline grounding, a data-flow architecture
  (raw → journals → knowledge → skills, read in reverse), subsidiarity between
  brains, and a `[brain]` config section (`format`, `origin`, `audience`,
  `readers`) parsed by both engines. `brainpick init` recognises a brain in
  place (honours `[bundle] root`, announces the brain) and, with no bundle
  yet, hands off to `uvx henxels init --template brainpick-brain` (or
  `okf-llm-wiki`). Principle 14 — a thin view, not a format owner: brainpick
  reads root, frontmatter and reserved names, never folder layout. README
  gained the five-layer stack diagram.
- Fixed: `[bundle] exclude` was ignored by compile and the freshness check
  (only the timeline honoured it) — both engines now scan with the config's
  include/exclude everywhere, so a brain's `raw/` stays greppable but never
  compiles.

## 2026-09-06

- Added: federation (spec/75) — one `brainpick mcp` fronts many brains. With
  no `--root` the brain set is the daemon's registry ∪ the bundle the working
  directory is in; `--root` is now repeatable (`ALIAS=DIR`). `brain_search`
  fans out, merges by score and qualifies paths as `alias:path`, with a
  `scope` (`all|here|me|aliases`); `brain_overview` lists `brains`;
  read/neighbors/write/show route by alias, and an unqualified `brain_write`
  lands *here* or declines. New `brainpick register [PATH] [--alias] [--user]
  [--remove]` in both engines; a second conformance fixture (`kotikirja`) and
  the `federated-query` class prove the merged hit set agrees. A single brain
  serves exactly as before.
- Fixed (found dogfooding against `~/Brain` + the docs wiki): federated search
  merged by score, which buried a T2-fresh brain (RRF ~0.03) under a T1-only
  one (BM25 ~4) — it now merges by rank, pinned by a conformance case that
  asserts the exact order in both engines. Unqualified docs now resolve tier
  by tier across the set, so an exact stem in one brain beats a fuzzy title
  in another. `brainpick register` prints the effective alias, never the id.
- Added: the migration path to federation — `brainpick register --from-hosts
  [--dry-run]` reads every `brainpick mcp --root DIR` from the agent host
  configs (Claude Code, OpenCode, Codex, Cursor) and registers each DIR, then
  prints the one user-scope entry that replaces them; `brainpick doctor` gains
  a `hosts:` line counting what is left to migrate. Both engines.
- Fixed: the daemon cached `brains.toml` for its whole life and serialized only
  the keys it knew — a brain registered for agents while `brainpickd` ran was
  overwritten on the daemon's next save, and `alias`/`role` were stripped. The
  daemon now re-reads the file on every access and round-trips unknown keys.
- Version 0.2.0: additive — one server fronts many brains; `--root` entries,
  tool signatures and single-brain payloads are unchanged.

## 2026-09-03

- Fixed: `[bundle] root` is now honoured by every command, not only `serve`
  and the auth commands. `compile`, `compile --check-fresh`, the four query
  mirrors, `mcp` and `doctor` resolve `--root` through the config's
  indirection via one shared `resolve_bundle()`, so a repo-root
  `brainpick.toml` pointing at a subdirectory bundle compiles the bundle
  (artifacts and the generated index land inside it) instead of scanning the
  repo root and resolving bundle-absolute links against the wrong folder.

## 2026-08-03

- Removed: LightRAG — the whole opt-in T3 extraction backend, its adapter
  branch, the Node engine's delegate-to-Python-sibling shim, and the
  `[graph]` install extra. T3 is algorithmic-only now; the `KGBackend` seam
  it ran behind stays as a test/mock hook.
- Added: the similarity gap-detector — T2 vectors joined against T1's link
  graph to surface semantically-similar, unlinked document pairs, replacing
  the role LLM extraction used to aim at, at zero model cost and
  cumulatively. New advisory artifact (`t1/similarity-gaps.json`), `GET
  /api/similarity-gaps`, a `brain_overview` count, an AGENTS.md digest
  section, and a warn-level henxel with a versioned
  `similarity-gaps-allowlist.toml` for reviewed-and-rejected pairs.
- Changed: `[modules] graph` simplifies to `on | auto | off` (`algorithmic`
  still accepted); `[models.extraction]` keeps exactly one live consumer,
  `brain_write`'s merge resolver. This wiki's own `docs/brainpick.toml` now
  enables the gap-detector for real — T2 was already fresh here.

## 2026-07-10

- Added: `about` and `type` now flow into `t1/docs.jsonl` and `t1/graph.json` (nullable, byte-parity both engines) so the UI can render the two-axis ontology; the ghost queue — `top_ghosts` in `brain_overview` and a "Top ghosts" section in the AGENTS.md brain report — surfaces up to 5 dead-link targets by distinct reference count, the agents' standing write-next list.
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
