---
type: Reference
title: Runtime parity
description: What the pip and npm packages each do natively — the capability matrix that keeps "one spec, two engines" honest, and how the claims are proven.
timestamp: 2026-07-04T00:00:00Z
---

# Runtime parity

`pip install brainpick` and `npm install brainpick` are native peers: the npm
package contains no Python and never shells out to any. Parity is defined by
the [artifact spec](artifact-spec.md) and proven by the shared conformance
fixtures both engines must pass — see [the tiers](the-tiers.md) for the
capability ladder these rows walk.

| Capability | pip | npm |
|-----------|-----|-----|
| T1 compile (graph, docs, generated index) | native | native |
| Watch + incremental recompile + [live deltas](live-deltas.md) | native | native |
| T2 compile (chunk, embed over HTTP, LanceDB write) | native | native |
| T2 in-process local embeddings (no endpoint) | native (fastembed) | steer to Ollama or sibling |
| T2 query (hybrid BM25 + vector fusion) | native | native |
| Serve: REST + web UI + live channel | native | native |
| MCP stdio + streamable HTTP (5 tools) | native | native |
| [Guarded writes](guarded-writes.md) + base_sha conflict detection | native | native |
| Stale-write merge proposal (three-way / LLM) | native | detects only — resolver is Python-first |
| Auth: tokens, password, sessions | native | native |
| init / doctor / integrate / the skill / CLI query mirrors | native | native |
| T3 compile — entity extraction (LightRAG) | M3, Python-only | M3, delegates to sibling |
| T3 query over the neutral export | M3 | M3 |

The asymmetries are principled, not accidental. Entity extraction (T3) is
anchored to the Python ecosystem, so when it lands the Node engine will
delegate that one compile step to an installed Python sibling or skip it with
an instruction — while still querying the resulting artifacts natively. The
merge-proposal resolver behind [guarded writes](guarded-writes.md) is
Python-first today; the Node engine detects the conflict identically and
returns the same shape, minus the proposed merge. `brainpick doctor` in each
runtime names exactly what the sibling would add.


## How parity is proven

Claims here are not promises — they are checked. The shared
`spec/conformance/cases.yaml` runs in both engines' test suites with zero
skips of a claimed case class; a pinned cross-engine scrypt vector makes auth
hashes identical byte-for-byte; and the LanceDB dataset one engine writes is
read by the other in a live interop test. This very page is codumented — its
matrix claims (identical CLIs, no Python in the npm package, LanceDB kept
optional, the merge-resolver gap) are validated on every push, so the doc
cannot quietly drift from the code.


