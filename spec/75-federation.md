# Federation — many brains behind one MCP server

An agent with twenty projects and one personal brain must not need twenty
MCP servers and a guess about which one holds the answer. Federation lets
one `brainpick mcp` process front a SET of independently compiled brains:
search fans out and merges, every path is qualified with the brain it came
from, and nothing is compiled across brains — each brain's artifacts stay
exactly what spec/00–40 say they are.

## The brain set

A **brain** is `{alias, root, role?, here?}` — an alias (its address in
every tool payload), the bundle root, an optional role and whether it is the
brain of the current working directory. The set is assembled at server
start, in this order:

1. **Explicit roots** — `brainpick mcp --root [ALIAS=]PATH` repeated. When
   any `--root` is given the set is exactly those roots, in the order
   given (the registry is NOT consulted — an explicit list is explicit).
2. Otherwise **the registry ∪ here**:
   - **here** — the nearest ancestor-or-self of the working directory that
     is a bundle root (holds `brainpick.toml` or `.brainpick/`), flagged
     `here: true`. A registry brain whose root contains the working
     directory IS here (no duplicate entry).
   - **the registry** — every enabled `[[brain]]` in
     `$XDG_CONFIG_HOME/brainpick/brains.toml` (default
     `~/.config/brainpick/brains.toml`; `BRAINPICK_REGISTRY` overrides the
     file path outright) whose root exists on disk. A local `repo` is
     served directly (`repo/bundle_path`); a remote `repo` is served from
     its clone under `$XDG_DATA_HOME/brainpick/brains/<id>/<bundle_path>`
     when that clone exists, else skipped — federation never clones.
   - Order: here first, then the `user`-role brain, then the rest in
     registry order.
3. An empty set falls back to the working directory as a single brain, so
   `brainpick mcp` with no registry behaves exactly as it always has.

**Federated iff the set holds more than one brain.** A single-brain server
produces the pre-federation payloads byte-for-byte; it still ACCEPTS
qualified paths (`alias:path`) so an agent may always qualify.

Brains load lazily — a brain's artifacts (compiling if stale, as any serve
does) are read the first time a tool touches it; `brain_overview` reads only
manifests.

## The registry

Shared with the daemon (`brainpickd`), which owns supervision; the engine
only READS it for federation and WRITES it via `brainpick register`. One
`[[brain]]` table per brain, hand-editable:

```toml
[[brain]]
id = "k7f3…"              # the bundle's [bundle] id when it has one, else minted
repo = "/home/me/brain"   # a local path or a git URL
bundle_path = ""          # subdirectory within repo ("" = the repo root)
port = 4750
enabled = true
host = "127.0.0.1"
alias = "me"              # optional — the federation address
role = "user"             # optional — "user" marks the personal brain (scope "me")
```

`brainpick register [PATH] [--alias A] [--user] [--remove]` adds (or, with
`--remove`, drops) the bundle at PATH; with no PATH it lists the registry
(`brainpick register .` is the explicit form for the working directory).
Writers emit keys in the order above, TOML basic strings, atomically (temp +
rename); readers drop a malformed entry and keep the rest. Unknown keys
survive a round trip — and every OTHER writer of this file (the daemon)
MUST preserve keys it does not interpret and MUST re-read the file before
writing, since `register` may have added entries meanwhile.

### Migrating per-project host entries

`brainpick register --from-hosts` is the one-command migration from the
pre-federation shape (one `brainpick mcp --root DIR` MCP entry per project in
each agent host) to one registry. It scans the known host config files under
`$HOME`:

| host | file | where the servers live |
|---|---|---|
| Claude Code | `~/.claude.json` | `mcpServers` and every `projects.<dir>.mcpServers` |
| OpenCode | `~/.config/opencode/opencode.json` | `mcp` (`command` is an array) |
| Codex | `~/.codex/config.toml` | `[mcp_servers.<name>]` (`command` + `args`) |
| Cursor / generic | `~/.cursor/mcp.json` | `mcpServers` |

A server counts when its command line (the `command` string plus `args`, or
the `command` array) contains the token `mcp` followed somewhere by
`--root DIR` (also `--root=DIR`). Each distinct DIR that is a bundle root is
registered exactly as `register DIR` would (an existing entry is left
alone); a DIR that no longer exists or is not a bundle is reported and
skipped. The command prints what it registered, then the single replacement
entry (`claude mcp add brainpick --scope user -- <brainpick> mcp`) and
notes that the old per-project entries can now be removed — it never edits
a host config itself. With `--dry-run` it only reports. Exit code 0 even
when nothing was found (a report, not a failure).

`brainpick doctor` adds a `hosts:` line: the number of per-project `--root`
entries the same scan finds, with the `--from-hosts` arrow when there are
any, and `○ hosts: none` otherwise.

## Aliases

`alias` when set; else the name of the git repository holding the bundle
(the nearest ancestor with `.git`, so `~/Git/acme/docs` is `acme`), or the
bundle directory's own name outside a repo, or a remote URL's basename
without `.git`. Slugified to `[a-z0-9-]`; a collision or a reserved word
(`all`, `here`, `me`) takes the suffix `-2`, `-3`, … in set order. Aliases
are stable for a given set and deterministic across engines.

## Qualified paths

`alias:bundle/relative/path.md`. In federated mode EVERY path a tool
returns is qualified — search hits, overview trees, read paths and
neighbors, neighbor nodes and edge endpoints, ghost targets — and every doc
argument accepts one. An UNQUALIFIED doc argument in federated mode
resolves in every brain with the forgiving ladder of spec/70 — applied
TIER BY TIER across the set: first the exact tier (path, or unique file
stem) in every brain, and only when no brain matches there the fuzzy-title
tier. Within a tier, exactly one brain resolving it is a hit; more than one
(or any brain finding it ambiguous) is a `disambiguation` listing qualified
paths. An exact hit in one brain therefore wins over a fuzzy title in
another — `brain_read 'video-generation'` opens `me:video-generation.md`
even when a project brain has a page titled "Video generation notes".
Nothing in any tier is a miss with up to five qualified suggestions. `brain_write` is the exception: an
unqualified doc writes to `here` when there is one, else declines with
`{"ok": false, "instruction": …}` naming the aliases — a write never
guesses its target.

## Scope

`brain_search` and `brain_overview` take `scope` (string, default `all`):

- `all` — every brain in the set
- `here` — the working directory's brain
- `me` — the `user`-role brain
- a comma-separated list of aliases (`acme,me`)

Unknown or unavailable names are dropped and named in `hint` (never an
error); when nothing survives, `all` applies with a note — forgiving enums,
as spec/70 demands.

## Federated search

Each brain in scope runs the ordinary spec/50 search (same `query`, `mode`,
`limit`); a brain's degradation (T2 stale, T3 absent) affects only its own
hits. Scores are NOT comparable across brains — a brain with T2 fresh
returns RRF fractions, one without T2 returns raw BM25 — so the merge is by
RANK, never by score: the merged list interleaves the brains' rankings
(every brain's first hit, then every brain's second, …), ties by set order
then path, and is cut to `limit`. Each hit keeps its brain's native `score`
for information; `hits` is therefore ordered by rank, not by `score`. The
response adds:

```json
{"hits": [{"path": "acme:render.md", "brain": "acme", "title", "description", "score", "why"}],
 "searched": ["acme", "me"], "contributing": ["acme"],
 "used_modes": [...], "degraded_from": null, "truncated": false, "hint"}
```

`used_modes` is the union over searched brains; `degraded_from` is set when
any brain degraded (the honest reading: not every hit had the full ladder).

## Federated overview

`brain_overview({scope?, budget_tokens?})` adds `brains` — one entry per
brain in the set, never budget-trimmed:

```json
{"brains": [{"alias": "acme", "role": null, "here": true, "root": "docs",
             "docs": 128, "tiers": {"t1": "fresh", "t2": "fresh", "t3": "fresh"}}],
 "bundle": "acme", "counts": {...}, "tiers": {...}, "tree": [...], ...}
```

`bundle`, `counts`, `tiers`, `tree`, `top_ghosts` and
`similarity_gaps_open_count` describe the FOCUS brain — `scope` when it
names exactly one brain, else `here`, else the first brain — with the tree's
paths qualified. A scope naming several brains lists them in `brains` and
focuses the first.

## The rest of the tools

`brain_read`, `brain_neighbors`, `brain_write` route to the brain a doc
resolves in and return that brain's ordinary payload with paths qualified
(the `neighbors`, `center`, `nodes` and `edges` fields alike) and a `brain`
field. `brain_show` targets the brain of its first resolved node (else
`here`); nodes from other brains are dropped and listed — a presentation is
one UI. `brain://index` is the focus brain's index; `brain://doc/{path}`
takes a qualified path.

## Conformance

Class `federated-query` (cases.yaml): compile each listed fixture bundle as
its own brain under the given alias, run the federated search, and assert
the top-k SET of qualified paths (order-insensitive, scores ignored).
Federation touches no artifact, so no golden changes.
