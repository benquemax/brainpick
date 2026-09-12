---
type: reference
about: concept
title: "Spec: REST API"
description: "The HTTP surface both servers implement — health, status, graph, docs (live and at any commit), search, neighbors, live, timeline, show, guarded writes and asset upload."
tags: [spec]
timestamp: 2026-09-13T09:00:00Z
---

# Spec: REST API

Both servers implement the same JSON REST surface, snake_case, binding
`127.0.0.1:4747` by default; errors are `{"error": "<instruction>"}` with a
4xx/5xx status. The endpoints: `/api/health`, `/api/status` (seq, tiers,
counts, `writes`, and the `ui` block), `/api/graph` (the graph.json payload, or
the entity graph; ETag by seq), `/api/docs/{path}` (with neighbors and a
`sha`; `?at=<sha>` serves the doc as of a commit via git — read-only, the
[time machine](../../time-machine.md)'s file-level half), `/api/search`,
`/api/neighbors`, `/api/live` (SSE), `/api/timeline`, `POST /api/show`,
`PUT /api/docs/{path}` (guarded write), and `POST /api/assets` (image
upload).

Search scoring is normative for conformance: BM25 (k1=1.2, b=0.75) over
`docs.jsonl`, with title weighted 3x, tags 2x, description 2x, text 1x, and
every token of 5+ characters also indexed and queried as its 4-character
prefix stem ([Search modes](../../search-modes.md)); conformance cases
`search-keyword-tag-only` and `search-keyword-stem` pin both. Auth, when
configured, gates `/api/*` and `/mcp` with a bearer token or session cookie.

This realizes [live deltas](../../live-deltas.md), the browser half of
[guarded writes](../../guarded-writes.md), and the REST face of
[presentations](../../presentations.md). Back to [Spec reference](../../reference-spec.md).
