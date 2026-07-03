# Update log

## 2026-07-03

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
