---
type: reference
about: concept
title: "Spec: federation"
description: "The normative contract for many brains behind one MCP server — brain set assembly, the registry, aliases and alias:path, scope, merged search, routed reads and the never-guessing write."
tags: [spec, mcp, agents]
timestamp: 2026-09-06T11:30:00Z
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
  `alias` and `role = "user"`, written by
  [brainpick register](../cli/register.md). Unknown keys survive a round trip.
- **Aliases.** Slugs `[a-z0-9-]`; `all`, `here`, `me` are reserved; collisions
  take `-2`, `-3` in set order. Every path from a federated server is
  `alias:path`; tools accept it back. An unqualified doc resolves across brains
  — one hit answers, more than one (or any in-brain ambiguity) yields a
  disambiguation of qualified paths, none is a miss with at most five
  qualified suggestions.
- **Scope.** `all` (default) | `here` | `me` | a comma-separated alias list,
  forgiving: unknown names are dropped with a note, and an empty choice falls
  back to all.
- **Search.** Hits from every brain in scope are merged by score (descending,
  ties by set order then path), then `limit` and `budget_tokens` apply. Each
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
- **Conformance.** The `federated-query` class runs a two-brain fixture
  (`kotiaurinko` + `kotikirja`) through `brain_search` and compares the set of
  qualified hits.

The concept is [federation](../../federation.md); the tools it changes are
under the [MCP tool reference](../../reference-mcp.md). Back to
[Spec reference](../../reference-spec.md).
