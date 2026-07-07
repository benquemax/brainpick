# MCP tools

Both engines expose the same six tools, verbatim, over stdio
(`brainpick mcp`), streamable HTTP (`/mcp`), and legacy SSE (`/sse`).
Small-model ergonomics are normative: at most one required argument
(`brain_write` is the sanctioned exception — `doc` and `content`),
unknown enum values fall back to defaults with a note (never an error),
every result carries a `hint` string naming a sensible next call, and every
tool accepts `budget_tokens` (int; chars/4 estimate; results are shaped to
fit — descriptions survive first, snippets/bodies are trimmed, and a
truncated result says so and how to get the rest).

## brain_overview()

No required args. → `{"bundle", "counts": {"docs", "edges", "tags",
"orphans", "ghosts"}, "tiers", "tree": [{"group", "docs": [{"path",
"title", "description"}]}], "hint"}`. Default budget 800.

## brain_search({query, mode?, limit?, budget_tokens?})

`mode ∈ auto|keyword|semantic|graph` (default `auto`). → `{"hits":
[{"path", "title", "description", "score", "why"}], "used_modes",
"degraded_from", "truncated", "hint"}`. Descriptions only — never full
bodies. `why` is one clause naming the match reason. Default budget 1200.

## brain_read({doc, sections?, budget_tokens?})

`doc` resolves forgivingly: exact path → unique file stem → fuzzy title;
an ambiguous resolution returns `{"disambiguation": [{"path", "title"}]}`
instead of content. → `{"path", "frontmatter", "outline": ["## …"],
"content", "neighbors": {"in": [...], "out": [...]}, "truncated", "hint"}`
where neighbor entries are `{"path", "title"}`. Over budget → outline +
leading excerpt + hint to request `sections`. Default budget 2000.

## brain_neighbors({doc, depth?, layer?, budget_tokens?})

`depth` 1–3 (default 1), `layer ∈ links|entities|both` (default `links`;
`entities` degrades to `links` with `degraded_from` until T3). →
`{"center", "nodes": [{"path", "title", "description", "distance"}],
"edges": [{"source", "target", "kind"}], "hint"}`. Default budget 800.

## brain_write({doc, content, mode?, base_sha?})

`mode ∈ create|replace|append_section` (default `create`). The guarded
write path:

1. Resolve `doc` to a bundle-relative kebab-case `.md` path (reject
   traversal outside the bundle).
2. Write atomically (temp + rename), then run the bundle's henxels
   contract against that path (when a contract exists).
3. Violations → restore the previous state and return `{"ok": false,
   "instruction": "<henxels output verbatim>"}`.
4. Pass → bump frontmatter `timestamp` (creating it if absent), trigger an
   incremental compile, emit the delta. → `{"ok": true, "path", "seq",
   "hint"}`.

**Optimistic concurrency (`base_sha`)**: writers SHOULD pass the sha256 of
the doc content they last read (available from the manifest, `docs.jsonl`,
or a future read response). When `base_sha` is present and differs from the
current file's sha256, the server MUST NOT write. It returns
`{ok: false, conflict: true, current_sha, theirs: <current content,
budget-shaped>, instruction: "the doc changed since you read it — re-read,
reconcile, retry with the new base_sha"}` — plus, when resolution is
possible, `merged: {content, strategy}` as a PROPOSAL (never auto-applied):

1. `strategy: "three-way"` — mechanical merge when base is known (git
   history or cached) and the edits do not overlap;
2. `strategy: "llm"` — a single-shot smart merge of base/theirs/yours
   through the configured `[models.extraction]` chat model, when one is
   configured — prose merges badly mechanically, so the model the brain
   already has doubles as the merge tool;
3. neither available → conflict response without `merged` (manual path).

Edge semantics: a doc DELETED since it was read conflicts with
`current_sha: null, theirs: null`. The `base_sha` comparison is evaluated
first, but a matching `base_sha` does not override `create`'s no-clobber
rule. Omitting `base_sha` preserves today's last-write-wins (writes stay
serialized server-side either way).

Servers expose `brain_write` only when config `[serve] writes = "guarded"`
(default) and, on non-localhost binds, only with a valid bearer token.

## brain_show({nodes?, focus?, mode?, annotation?, clear?})

Agent-driven presentations — spotlight a subgraph, fly the camera to `focus`,
switch `mode`, and caption it, pushed LIVE to every open UI (the agent side
reaching across to the human side). Every argument is optional; `nodes` accept
doc paths (fuzzy/kebab-resolved like `brain_read`) and entity names, unresolved
entries are dropped and listed, `focus` defaults to the first resolved node, and
an empty call or `clear: true` clears the current presentation. → `{"ok": true,
"shown": <resolved count>, "dropped": [<unresolved>], "seq", "hint"}` where `seq`
is a monotonic PRESENTATION counter distinct from the manifest seq. Unlike
`brain_write` it is ephemeral and advisory — it never writes the brain, so it is
NOT behind `[serve] writes`, only the normal auth. The presentation payload
shape, the `brain.show` live event, and `POST /api/show` are the contract of
`95-presentations.md`.

## Resources

`brain://index` (the generated index block) and `brain://doc/{+path}` (raw
document content). Optional in 0.1; hosts without resource support lose
nothing — the tools cover everything.
