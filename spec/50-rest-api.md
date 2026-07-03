# REST API

Both servers implement this surface. All responses are JSON (except `/` and
`/api/live`), UTF-8, with camel-free snake_case keys. Errors are
`{"error": "<one-line instruction>"}` with a 4xx/5xx status. Servers bind
`127.0.0.1:4747` by default.

| Endpoint | Returns |
|----------|---------|
| `GET /api/health` | `{"impl": "python", "name": "brainpick", "spec_version": "0.1", "version": "0.1.0"}` |
| `GET /api/status` | manifest summary: `seq`, `tiers`, `docs`, `edges`, `ghosts`, `orphans`, `bundle_root` (the server's absolute bundle path — more useful to clients than the manifest's relative `"."`), `watching` |
| `GET /api/graph?layer=links` | the full `t1/graph.json` payload (`layer=entities` → 404 until T3; ETag = `"<seq>"`, honor `If-None-Match` with 304) |
| `GET /api/docs/{path}` | `{"path", "frontmatter", "title", "text", "neighbors": {"in": [...], "out": [...]}}` where neighbor entries are `{"path", "title"}` — on miss, 404 with `{"error": "<instruction>", "suggestions": ["<path>", …]}` (≤ 5 fuzzy matches) |
| `GET /api/search?q=&mode=auto&limit=8` | `{"hits": [{"path", "title", "description", "score", "snippet", "source"}], "used_modes": [...], "degraded_from": null}` |
| `GET /api/neighbors?id=&depth=1&layer=links` | `{"center", "nodes": [...], "edges": [...]}` — node/edge shapes as in graph.json; `layer=entities` before T3 degrades to links with `"degraded_from": "entities"` (matching MCP semantics — only `/api/graph` 404s) |
| `GET /api/live` | SSE stream, see `60-live-deltas.md` |
| `GET /` | the static web UI (SPA fallback to `index.html`) |

Spec 0.1 requires modes `keyword` and `auto` (`auto` = keyword when nothing
else is available; response says `"used_modes": ["keyword"]`). Unknown
`mode` values fall back to `auto` — never an error. `snippet` is the first
match window ≤ 240 chars, or `null`. A hit's `source` names the retriever
that produced it (`keyword | semantic | graph`; under fusion, the
highest-contributing one).

Search scoring (normative for conformance): BM25 (k1=1.2, b=0.75) over
`docs.jsonl` records. The searchable text of a document is the `title`
repeated three times, the `description` twice, and `text` once, joined by
newlines — a deterministic field weighting both runtimes reproduce
trivially — lowercased, tokenized on Unicode non-alphanumeric boundaries
(`_` is a boundary). Reserved documents are excluded from search results.
Conformance asserts the top-k result SET, not scores.
