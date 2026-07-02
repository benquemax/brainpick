# MCP tools

Both engines expose the same five tools, verbatim, over stdio
(`brainpick mcp`), streamable HTTP (`/mcp`), and legacy SSE (`/sse`).
Small-model ergonomics are normative: at most one required argument,
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

## brain_write({doc, content, mode?})

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

Servers expose `brain_write` only when config `[serve] writes = "guarded"`
(default) and, on non-localhost binds, only with a valid bearer token.

## Resources

`brain://index` (the generated index block) and `brain://doc/{+path}` (raw
document content). Optional in 0.1; hosts without resource support lose
nothing — the tools cover everything.
