---
type: reference
about: concept
title: "Spec: federation"
description: "The normative contract for many brains behind one MCP server — brain set assembly, the registry, aliases and alias:path, scope, merged search, routed reads and the never-guessing write."
tags: [spec, mcp, agents]
timestamp: 2026-09-06T16:00:00Z
---

# Spec: federation

`spec/75-federation.md` fixes how one `brainpick mcp` process fronts several
brains so both engines agree byte-for-byte on what an agent sees.

- **Brain set assembly.** Explicit `--root [ALIAS=]PATH` flags (repeatable)
  win outright. Otherwise the set is the registry ∪ *here* (the bundle root
  above the working directory), ordered here → user → the rest; an empty set
  is the working directory alone. Disabled and missing entries are skipped;
  federation never clones. The server is *federated* iff the set holds more
  than one brain; brains load lazily.
- **The registry.** The daemon's `brains.toml` — `[[brain]]` tables with `id`,
  `repo`, `bundle_path`, `port`, `enabled`, `host` — gains two optional keys,
  `alias` and `role = "cortex"`, written by
  [brainpick register](../cli/register.md). Unknown keys survive a round trip.
- **Aliases.** Slugs `[a-z0-9-]`; `all`, `here`, `me` are reserved; collisions
  take `-2`, `-3` in set order. Every path from a federated server is
  `alias:path`; tools accept it back. An unqualified doc resolves across brains
  tier by tier — the exact tier (path, stem) in every brain before any brain's
  fuzzy-title tier; within a tier one hit answers, more than one (or any
  in-brain ambiguity) yields a disambiguation of qualified paths; nothing in
  any tier is a miss with at most five qualified suggestions.
- **Scope.** `all` (default) | `here` | `me` | a comma-separated alias list,
  forgiving: unknown names are dropped with a note, and an empty choice falls
  back to all.
- **Search.** Hits from every brain in scope are merged by RANK — the
  brains' first hits, then their second, … (ties by set order then path) —
  never by score, which is not comparable across brains (RRF vs raw BM25);
  each hit keeps its native `score`. Then `limit` and `budget_tokens` apply. Each
  hit carries `brain`; the answer adds `searched`, `contributing`, the union
  of `used_modes`, and `degraded_from` when any brain degraded.
- **Overview.** `brains: [{alias, role, here, root, docs, tiers}]` is never
  trimmed; the tree is the focus brain's (scope if it names one, else here,
  else the first) with qualified paths.
- **Routed tools.** `brain_read`, `brain_neighbors` and `brain_show` answer
  with a `brain` field; `brain_write` writes an unqualified target *here* or
  declines naming the aliases — it never guesses.
- **Single-brain compatibility.** A set of one brain keeps the pre-federation
  payload shapes exactly, while still accepting qualified docs.
- **Migration.** `brainpick register --from-hosts` scans the known host
  config files (Claude Code, OpenCode, Codex, Cursor) for `mcp --root DIR`
  command lines and registers each DIR; it never edits a host config. Every
  other writer of `brains.toml` (the daemon) re-reads before writing and
  preserves unknown keys. `brainpick doctor` reports the count on a `hosts:`
  line.
- **Conformance.** The `federated-query` class runs a two-brain fixture
  (`kotiaurinko` + `kotikirja`) through `brain_search` and compares the set of
  qualified hits — and, with one brain given the mock embedder (`embed`), the
  exact rank-merged order (`expect_order`).

The concept is [federation](../../federation.md); the tools it changes are
under the [MCP tool reference](../../reference-mcp.md). Back to
[Spec reference](../../reference-spec.md).
