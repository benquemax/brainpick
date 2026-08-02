---
type: article
about: thing
title: Static snapshot
description: A brain baked into a fully static site — the engine's own API responses as files plus a UI build that searches, walks and time-travels client-side; the GitHub Pages demo path.
tags: [ui, deploy]
timestamp: 2026-08-02T19:45:00Z
---

# Static snapshot

`scripts/build-static-site.mjs` bakes a compiled brain into a directory any
static host can serve — no engine process, no Python, no Node behind the
page. It is the demo path: every release deploys this repository's own docs
brain to GitHub Pages, so "what does brainpick look like?" is a link, not an
install.

The recipe is deliberately parasitic on the real product. The exporter runs
the [compile pipeline](compile-pipeline.md), starts the actual engine, and
snapshots the server's own responses to files — every baked byte is a real
API answer, so the demo cannot drift from the live contract. Alongside the
`api/` tree it builds the web UI in static-snapshot mode
(`VITE_STATIC_SNAPSHOT=1`): a relative base so any subpath works, no PWA
service worker, and a client-side stand-in for each per-query surface a
static host cannot answer (query strings never reach a file).

| Live surface | Static answer |
| --- | --- |
| `GET /api/graph?layer=…` | distinct baked files per layer |
| `GET /api/search?q=…` | client-side keyword scoring over a baked full-text index |
| `GET /api/neighbors?id=…` | one baked neighborhood per doc |
| `GET /api/docs/{path}?at=…` | one baked file per distinct doc version, resolved client-side from the timeline |
| `GET /api/live` (SSE) | none — the connection state is `snapshot`, terminal and honest |

Degradation is honest, in the spirit of [search modes](search-modes.md): an
explicit semantic or graph ask answers keyword-degraded and says so with the
same chip the live UI uses; auto simply delivers the best available. Writes
are advertised off, so the editor never appears. The
[time machine](time-machine.md) travels fully — the timeline and every doc
version ride along in the bake — while [live deltas](live-deltas.md) are the
one thing a snapshot, by definition, does not have.

The `publish-pages` job in the release workflow rebuilds and redeploys the
demo on every published version, so the hosted brain always shows the
release it ships with. Anyone can point the same script at their own bundle
(`--root`, `--out`) to publish a read-only brain on any static host; for a
served, writable brain there is [onboarding](onboarding.md) and
[the desktop app](desktop-app.md).
