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

## The six MCP tools

Call these if a `brainpick` MCP server is connected (tools are named `brain_*`):

- `brain_overview()` — one screen: counts, tiers, every doc grouped by folder. Call first.
- `brain_search({query})` — find docs by meaning/keyword. Returns paths + descriptions, never full bodies. `mode` is `auto` (default), `keyword`, `semantic`, or `graph`.
- `brain_read({doc})` — open one doc. `doc` is forgiving: a path (`kuu.md`), a bare stem (`kuu`), or an approximate title. Pass `sections:["Heading"]` to read just parts.
- `brain_neighbors({doc})` — walk the links around a doc (`depth` 1–3). Find what connects to what.
- `brain_write({doc, content})` — add a doc, guarded by the repo's contract. See "Writing" below.
- `brain_show({nodes})` — spotlight a subgraph live in an open brainpick UI: highlight nodes, fly the camera, caption it. "Let me explain" becomes "let me show you." See "Showing the brain" below — **it needs a running `brainpick serve`, unlike the other five.**

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

## Several brains at once (federation)

One server can front many brains: `brainpick register <bundle>` once per brain
(`--user` for your personal one), then a single user-scope entry with no
`--root` — `claude mcp add brainpick --scope user -- uvx brainpick mcp`. Every
registered brain plus the project you are in answers. When the server is
federated:

- `brain_overview` lists `brains` (alias, role, `here`); its `scope` picks the tree.
- `brain_search` searches every brain by default and tags each hit with its `brain`;
  `scope` narrows it — `here`, `me`, or `alias,alias`. Hits are ordered by rank
  across brains; `score` values are only comparable within one brain.
- Every path is `alias:path` — pass it back verbatim to `brain_read`, `brain_neighbors`,
  `brain_write`. A bare doc resolves across brains; several matches come back as a
  disambiguation.
- `brain_write` with a bare target writes to the project you are in; qualify it to
  write elsewhere. It never guesses.

## Showing the brain (brain_show)

Use `brain_show` when explaining beats showing — "let me show you" instead of a
wall of text. It highlights nodes, flies the camera, and drops a caption into
every **connected** brainpick UI. It never writes the brain.

**It needs a running `brainpick serve`.** The other five tools work over a plain
stdio MCP connection (`claude mcp add brainpick -- brainpick mcp --root <bundle>`,
the common setup) because they only read compiled artifacts. `brain_show`
broadcasts to a live browser — and a stdio-connected MCP server has none attached;
it builds its own private, unshared state. Call it over stdio today and you get
back `{"ok": true, "shown": N}` while nothing appears anywhere — a false positive,
not a "no UI open" signal.

To actually see it: start `brainpick serve --root <bundle>` first (a browser tab
open to it, or `POST /api/show` with the same body, both work), or connect your
MCP client over HTTP to that server's `/mcp` endpoint instead of stdio. If you
called `brain_show` and the human says they saw nothing, don't trust the `"ok"`
— ask what's actually running before repeating the call.

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
