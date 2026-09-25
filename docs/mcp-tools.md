---
type: reference
about: concept
title: MCP tools
description: The MCP tools brainpick exposes — overview, search, read, neighbors, write, show, contract, and the gated sync verbs — designed so a 27B model guesses right on the first try.
tags: [agents, mcp]
timestamp: 2026-09-19T00:20:00Z
---

# MCP tools

Brainpick serves agents over MCP in three transports: stdio (`brainpick
mcp`, what the init snippets configure), streamable HTTP at `/mcp`, and
legacy SSE at `/sse`. Both engines define the same tools verbatim; the
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

7. **`brain_contract({brain?})`** — what this bundle must satisfy for
   brainpick to work, as data: every requirement with its `id`, whether it is
   met, what it means and why it matters, plus a `fix` for each unmet one.
   Always exposed, read-only.

## What brainpick requires of a bundle

An implant is deliberately free to choose its own folder layout, file naming
and memory types — that freedom is the point, and engines never report a
project's layout as a defect. What brainpick actually needs is short, and
`brain_contract` announces it rather than making you read the source:

| `id` | Required | What |
|------|----------|------|
| `bundle-root` | yes | a directory holding `brainpick.toml`, or named by `--root` |
| `manifest` | yes | `.brainpick/manifest.json`, valid JSON, from `brainpick compile` |
| `artifacts` | yes | the `t1/` artifacts the manifest names, readable |
| `fresh` | no | artifacts newer than the sources they were compiled from |
| `frontmatter` | no | docs carry OKF frontmatter; `type` is the one MUST |
| `brain-format` | no | `[brain] format` — absent means a wiki, which is legitimate |

It is `brainpick doctor` for agents rather than humans: doctor prints ✓/✗
lines to a terminal, and an agent operating a brain over MCP cannot read
them. Call it when a brain reports unreadable, or before wiring a new
implant.

## Sync: pulling and pushing shared memory

A brain is shared memory held in Git, so the checkout drifts — another agent
commits between two of your calls, another machine edits the same journal on
the same day. Three verbs close that gap without exposing git itself:

- **`brain_status({brain?})`** — ahead, behind, dirty, conflicted. Read-only.
- **`brain_sync({brain?})`** — fetch, merge, resolve what collides **doc-wise**
  through the same proposal ladder [guarded writes](guarded-writes.md) uses,
  recompile. Commits nothing: merged docs are proposals to review, unresolved
  ones come back with both versions.
- **`brain_push({message, brain?})`** — compile, run the henxels contract,
  stage the bundle, commit, push.

Two guarantees are worth stating plainly. **No conflict markers ever reach a
doc** — `<<<<<<<` inside frontmatter is invalid YAML, which fails the contract
and the compile for every later reader, so an unresolvable doc is reported
with both versions instead of mangled. And **a clean merge is not a reviewed
merge**: two agents can each append a true fact and produce a page that says
two contradictory things, so sync resolves structure and leaves truth to a
reader.

On a brain mounted [read-only](read-only-implants.md) the same verbs bend:
sync fast-forwards only (a mirror takes upstream's commits and creates
none) and push refuses with a redirect. Two more verbs cover that case —
**`brain_contribute`** stages a fix as a commit in a separate working copy
(a git worktree) and **`brain_submit`** sends it upstream as a pull
request, never touching the original repository; the whole flow is
[contributing to an implant](contributing-to-an-implant.md).

`brain_push` runs the contract *itself* rather than trusting the git hook.
The henxels-managed hook warns and exits 0 when it cannot resolve the
`henxels` executable — reasonable for a human at a terminal, dangerous for an
MCP server, which is the process most likely to have a stripped PATH. A push
whose contract was skipped is not a verified push, so "could not run" is a
refusal, not a pass.

These verbs are gated by `[serve] git = off | status | sync | contribute |
push`, **default `off`**: upgrading adds no git capability, and a tool
outside the configured level is absent from `tools/list` rather than
refusing when called. The ladder climbs upwards — `contribute` sits below
`push` because a proposal can never write a repository the agent does not
own.

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
