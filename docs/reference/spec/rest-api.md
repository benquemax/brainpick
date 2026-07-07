---
type: Reference
title: "Spec: REST API"
description: "The HTTP surface both servers implement — health, status, graph, docs, search, neighbors, live, timeline, show, guarded writes and asset upload."
timestamp: 2026-07-08T00:00:00Z
---

# Spec: REST API

Both servers implement the same JSON REST surface, snake_case, binding
`127.0.0.1:4747` by default; errors are `{"error": "<instruction>"}` with a
4xx/5xx status. The endpoints: `/api/health`, `/api/status` (seq, tiers,
counts, `writes`, and the `ui` block), `/api/graph` (the graph.json payload, or
the entity graph; ETag by seq), `/api/docs/{path}` (with neighbors and a
`sha`), `/api/search`, `/api/neighbors`, `/api/live` (SSE), `/api/timeline`,
`POST /api/show`, `PUT /api/docs/{path}` (guarded write), and
`POST /api/assets` (image upload).

Search scoring is normative for conformance: BM25 (k1=1.2, b=0.75) over
`docs.jsonl`, with title weighted 3x, description 2x, text 1x. Auth, when
configured, gates `/api/*` and `/mcp` with a bearer token or session cookie.

This realizes [live deltas](../../live-deltas.md), the browser half of
[guarded writes](../../guarded-writes.md), and the REST face of
[presentations](../../presentations.md). Back to [Spec reference](../../reference-spec.md).
