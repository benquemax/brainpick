---
type: reference
about: concept
title: MCP tools
description: The six MCP tools brainpick exposes — overview, search, read, neighbors, write, show — designed so a 27B model guesses right on the first try.
tags: [agents, mcp]
timestamp: 2026-09-18T21:45:00Z
---

# MCP tools

Brainpick serves agents over MCP in three transports: stdio (`brainpick
mcp`, what the init snippets configure), streamable HTTP at `/mcp`, and
legacy SSE at `/sse`. Both engines define the same six tools verbatim; the
contract lives in the spec, not in either implementation.

The ergonomics are small-model-first: at most one required argument, obvious
names, forgiving enums (an unknown mode falls back to `auto` with a note),
token budgets on every call, and every result ending with a one-line hint of
what to call next.

1. **`brain_overview({scope?})`** — orientation: bundle name,
   document/tag/entity counts, tier availability, the top-level index tree
   with one-sentence descriptions, and usage hints — plus the list of brains
   when several sit behind one server. The progressive-disclosure root.
2. **`brain_search({query, mode?, limit?, scope?, budget_tokens?})`** —
   returns titles and descriptions only, never full documents, each hit
   annotated with *why* it matched. Modes are described in
   [search modes](search-modes.md); `scope` picks brains under
   [federation](federation.md).
3. **`brain_read({doc, sections?, budget_tokens?})`** — forgiving
   resolution (path, id, or fuzzy title), body or requested sections, and an
   outline-first answer when the note exceeds the budget.
4. **`brain_neighbors({doc, depth?, layer?})`** — adjacency with
   descriptions, on the explicit-link layer, the entity layer of the
   [knowledge graph tier](knowledge-graph-tier.md), or both.
5. **`brain_write({doc, content, mode})`** — the one write path, guarded by
   the henxels contract; see [guarded writes](guarded-writes.md).
6. **`brain_show({nodes?, focus?, mode?, annotation?, clear?})`** — agent-driven
   [presentations](presentations.md): spotlight a subgraph, fly the camera to
   it, and caption it live in every open UI. Every argument is optional, and it
   is ephemeral and advisory — it never writes the brain.

## Every call sees the current brain

A tool call observes the artifacts on disk, not a snapshot taken when the
server started. Before reading held state, the server compares the
manifest's `seq` against the one behind its artifacts and, when they
differ, adopts the new [compile](compile-pipeline.md) and emits the same
delta a watcher would — so an agent on stdio and a browser on `/mcp` agree.

This matters because a brain is shared memory. `git pull`, a CLI `brainpick
compile`, another agent, or another machine all change the bundle from
outside the server's process. A server that refreshed only on its own
`brain_write` would answer from a snapshot that silently ages for the whole
session, and a stale read looks exactly like a confident correct answer at
the call site — the reader has no way to tell. Freshness is therefore part
of the tool contract rather than a property of the transport or the host,
and it never depends on a filesystem watcher being available.

Adoption is cheap: an unchanged manifest costs one `stat`, so it runs on
every call. It never compiles — a bundle whose sources moved without a
compile stays unseen, because the manifest is the handoff between the
compiler and every reader. Under [federation](federation.md) each brain is
adopted independently, on the calls that touch it.

One server can front many brains — every registered brain plus the one the
agent works in — with merged search and `alias:path` addressing; that is
[federation](federation.md). Two resources complement the tools:
`brain://index` (the generated index) and `brain://doc/{path}`. Progressive disclosure mirrors OKF's own philosophy:
descriptions first, hydration on demand — an agent never pays for content it
did not ask for, and never maintains any of it by hand.
