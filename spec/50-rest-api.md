# REST API

Both servers implement this surface. All responses are JSON (except `/` and
`/api/live`), UTF-8, with camel-free snake_case keys. Errors are
`{"error": "<one-line instruction>"}` with a 4xx/5xx status. Servers bind
`127.0.0.1:4747` by default.

| Endpoint | Returns |
|----------|---------|
| `GET /api/health` | `{"impl": "python", "name": "brainpick", "spec_version": "0.1", "version": "0.1.0"}` |
| `GET /api/status` | manifest summary: `seq`, `tiers`, `docs`, `edges`, `ghosts`, `orphans`, `bundle_root` (the server's absolute bundle path — more useful to clients than the manifest's relative `"."`), `watching`, `writes` (bool — `[serve] writes == "guarded"`, so the editor shows its Edit affordance only when writing is possible), and `ui` (the `[ui]` block — `{"max_nodes_mobile": <int>, "default_mode": "cosmos"\|"brain"}` from config (spec/80), so the client sizes the cosmos and picks its opening view instead of guessing from the GPU tier) |
| `GET /api/graph?layer=links` | the full `t1/graph.json` payload. `layer=entities` → the entity graph `{nodes, edges}`, each node `{id, name, type, description, degree, source_docs}` and each edge `{src, dst, weight}`; `source_docs` is the sorted, bundle-relative list of docs the entity was extracted from (its provenance, so the UI's entity panel shows sources without N extra calls). `layer=entities` → 404 until T3. ETag = `"<seq>"`, honor `If-None-Match` with 304 |
| `GET /api/docs/{path}` | `{"path", "frontmatter", "title", "text", "sha", "neighbors": {"in": [...], "out": [...]}}` where neighbor entries are `{"path", "title"}`; `sha` is the sha256 of the raw file bytes (the editor's next `base_sha`), `null` for a doc held only as a deleted record — on miss, 404 with `{"error": "<instruction>", "suggestions": ["<path>", …]}` (≤ 5 fuzzy matches) |
| `GET /api/search?q=&mode=auto&limit=8` | `{"hits": [{"path", "title", "description", "score", "snippet", "source"}], "used_modes": [...], "degraded_from": null}` |
| `GET /api/neighbors?id=&depth=1&layer=links` | `{"center", "nodes": [...], "edges": [...]}` — node/edge shapes as in graph.json; `layer=entities` before T3 degrades to links with `"degraded_from": "entities"` (matching MCP semantics — only `/api/graph` 404s) |
| `GET /api/live` | SSE stream, see `60-live-deltas.md` |
| `GET /api/timeline` | `timeline.json` (see `90-timeline.md`); `{"commits": [], "docs": {}, "span": null}` when the bundle has no git history. ETag by `seq` |
| `POST /api/show` | agent-driven presentation (see `95-presentations.md`); `{nodes?, focus?, mode?, annotation?, clear?}` → broadcasts a `brain.show` live event → `{ok, shown, dropped, seq}` |
| `PUT /api/docs/{path}` | guarded doc write (see "Writing" below); `{content, base_sha?, mode?}` → `200 {ok,path,seq,sha}` / `422` henxels / `409` conflict |
| `POST /api/assets` | upload an image into the bundle's `assets/` (see "Writing"); → `201 {path, sha, bytes}` |
| `GET /` | the static web UI (SPA fallback to `index.html`; login page when a password is set and no session) |
| `POST /api/login` | `{password}` → 204 + signed session cookie, 401 on mismatch |
| `POST /api/logout` | clears the session |

When auth is configured (spec/80), unauthenticated `/api`/`/mcp` requests
get `401 {"error": "authentication required — send Authorization: Bearer
<token> (create one: brainpick token create) or log in"}` with
`WWW-Authenticate: Bearer`; `/api/live` accepts `?token=` as well. |

Spec 0.1 requires modes `keyword` and `auto` (`auto` = keyword when nothing
else is available; response says `"used_modes": ["keyword"]`). Unknown
`mode` values fall back to `auto` — never an error. `snippet` is the first
match window ≤ 240 chars, or `null`. A hit's `source` names the retriever
that produced it (`keyword | semantic | graph`; under fusion, the
highest-contributing one).

## Writing (guarded — the browser editor's path)

`PUT /api/docs/{path}` is the HTTP face of the guarded write path defined for
`brain_write` (spec/70) — the SAME resolve → atomic write → henxels referee →
rollback-or-recompile → live-delta machinery, the SAME `base_sha` optimistic
concurrency and merge ladder. Body: `{content, base_sha?, mode?}` (`mode ∈
create|replace|append_section`, default `replace` for an editor saving a full
doc). Responses mirror `brain_write` mapped onto status codes:

- `200 {"ok": true, "path", "seq", "sha"}` — written; `sha` is the new
  content sha256 (the client's next `base_sha`).
- `422 {"ok": false, "instruction": "<henxels output verbatim>"}` — the
  contract rejected it; the write was rolled back. The editor shows the
  instruction inline (this is the point of guarded writes — the brain teaches
  the writer). NOT a 400: the request was well-formed, the content was not.
- `409 {"ok": false, "conflict": true, "current_sha", "theirs", "instruction",
  "merged"?}` — `base_sha` no longer matches; identical shape to
  `brain_write`'s conflict, including the optional `merged: {content,
  strategy}` proposal (three-way | llm). Never auto-applied.

Writes are exposed only when `[serve] writes = "guarded"` (spec/80) and, on
non-localhost binds, only with a valid bearer token or session — otherwise
`403 {"error": "writes are disabled — set [serve] writes = \"guarded\""}`. A
path resolving outside the bundle, or a non-`.md` target, is `400`.

## Assets (embedded images)

`POST /api/assets` stores an uploaded image under `<bundle>/assets/` and
returns its bundle-relative path for embedding as `![alt](assets/<name>)`.
Request: `multipart/form-data` with a `file` part (+ optional `name`).
Constraints: image content-types only (png/jpeg/webp/gif/svg), a size cap
(`[serve] max_asset_bytes`, default 8 MiB), filename sanitized to
`[a-z0-9._-]` kebab; on a name collision with DIFFERENT bytes, a short
content-hash suffix is appended (identical bytes de-duplicate to the same
path). Same auth/`writes` gate as doc writes. `assets/` holds no `.md`, so it
is invisible to the graph, index and timeline; the henxels contract must
permit it (a bundle asset, not a concept). Response `201 {"path":
"assets/<name>", "sha", "bytes"}`.

Search scoring (normative for conformance): BM25 (k1=1.2, b=0.75) over
`docs.jsonl` records. The searchable text of a document is the `title`
repeated three times, the `description` twice, and `text` once, joined by
newlines — a deterministic field weighting both runtimes reproduce
trivially — lowercased, tokenized on Unicode non-alphanumeric boundaries
(`_` is a boundary). Reserved documents are excluded from search results.
Conformance asserts the top-k result SET, not scores.
