---
type: Reference
title: Runtime parity
description: What the pip and npm packages each do natively — the capability matrix that keeps "one spec, two engines" honest.
timestamp: 2026-07-02T00:00:00Z
---

# Runtime parity

`pip install brainpick` and `npm install brainpick` are native peers: the npm
package contains no Python and never shells out to any. Parity is defined by
the [artifact spec](artifact-spec.md) and proven by the shared conformance
fixtures both engines must pass.

| Capability | pip | npm |
|-----------|-----|-----|
| T1 compile (graph, docs, index, layout, timeline) | native | native |
| Watch + incremental recompile + [live deltas](live-deltas.md) | native | native |
| T2 compile (chunk, embed over HTTP, LanceDB write) | native | native |
| T2 in-process local embeddings (no endpoint) | native (fastembed) | steer to Ollama or sibling |
| T2 query (hybrid BM25 + vector fusion) | native | native |
| T3 compile (LightRAG extraction) | native | delegates to sibling |
| T3 query over the neutral export | native | native |
| MCP stdio / streamable HTTP / SSE | native | native |
| REST + web UI + live channel | native | native |
| init / doctor / henxels integration | native | native |

The asymmetries are principled, not accidental, and follow
[the tiers](the-tiers.md): entity extraction is anchored to the Python
ecosystem, so the Node engine either delegates that one compile step to an
installed Python sibling or skips it with an instruction — while still
querying the resulting artifacts natively. `brainpick doctor` in each runtime
names exactly what the sibling would add.
