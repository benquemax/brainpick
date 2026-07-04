---
name: brainpick
description: Consult the compiled knowledge brain (a graph of this repo's docs) BEFORE grepping or answering questions about the project. Use whenever a brainpick brain is available — the brain_* MCP tools or the `brainpick` CLI.
---

# brainpick — pick the brain before you grep

This repo (or a folder in it) is compiled into a **brain**: a searchable graph of
its docs. Reading the brain is faster and truer than grepping raw files — it knows
titles, descriptions, links, and neighbors.

## The rule

**Before you grep, glob, or answer a "how does X work?" question, ask the brain.**
Grep finds strings; the brain finds meaning and the docs around it. Grep only after
the brain comes up short.

Start every session with one call to get oriented, then search.

## The five MCP tools

Call these if a `brainpick` MCP server is connected (tools are named `brain_*`):

- `brain_overview()` — one screen: counts, tiers, every doc grouped by folder. Call first.
- `brain_search({query})` — find docs by meaning/keyword. Returns paths + descriptions, never full bodies. `mode` is `auto` (default), `keyword`, `semantic`, or `graph`.
- `brain_read({doc})` — open one doc. `doc` is forgiving: a path (`kuu.md`), a bare stem (`kuu`), or an approximate title. Pass `sections:["Heading"]` to read just parts.
- `brain_neighbors({doc})` — walk the links around a doc (`depth` 1–3). Find what connects to what.
- `brain_write({doc, content})` — add a doc, guarded by the repo's contract. See "Writing" below.

Every result carries a `hint` naming a sensible next call. Follow it.

## The CLI equivalents

No MCP server? The same four reads are CLI verbs. Pick the invocation that runs here:

- Published (Python): `uvx brainpick search "vuorovesi"` · `read kuu` · `neighbors kuu` · `overview`
- Dev checkout (Python): `uv run brainpick search "vuorovesi" --root <bundle>`
- Node engine: `node /path/to/brainpick/dist/cli.js search "vuorovesi"` (or `npx brainpick search …` once published)

Add `--json` for machine-readable output, `--root <dir>` to point at the bundle,
`--mode`/`--limit` on search, `--depth` on neighbors. If the CLI says the brain
is not compiled, run `brainpick compile --root <bundle>` first.

Wire the MCP server into your host with `brainpick mcp` — e.g.
`claude mcp add brainpick -- uvx brainpick mcp --root <bundle>`.

## Writing knowledge back (brain_write)

Only write when asked to record knowledge. Follow the wiki's conventions or the
write is rejected by the contract:

- **One concept per page**, filename **kebab-case** `.md` (`kuun-vaiheet.md`).
- **Frontmatter**: `type` (Concept/Reference/Decision/Playbook), `title`,
  `description`, `timestamp` — the brain bumps `timestamp` for you.
- **Link generously**; the **link text is the target doc's title** (`[Kuu](kuu.md)`).
  A doc with no links is an orphan.
- **Optimistic concurrency**: pass `base_sha` = the sha256 of the content you last
  read. On a mismatch nothing is written and you get the current content back —
  re-read, reconcile, retry with the new `base_sha`.

## Auth

If the brain answers `401`, it wants a bearer token. Send
`Authorization: Bearer <token>` (mint one with `brainpick token create`). Local
stdio MCP is never gated.
