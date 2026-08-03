---
type: reference
about: concept
title: Runtime parity
description: What the pip and npm packages each do natively — the capability matrix that keeps "one spec, two engines" honest, and how the claims are proven.
tags: [engine]
timestamp: 2026-08-03T00:00:00Z
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
| Stale-write merge proposal (three-way / LLM) | native | native |
| Auth: tokens, password, sessions | native | native |
| init / doctor / integrate / the skill / CLI query mirrors | native | native |
| T3 compile — entity derivation (algorithmic) | native | native |
| T3 query over the neutral export | M3 | M3 |

The remaining asymmetries are principled, not accidental — T2's in-process
local embedding path steers to each ecosystem's own native option rather than
forcing one runtime to shell out to the other. T3 used to be the other
asymmetric row (LLM extraction anchored to the Python ecosystem, with Node
delegating that one compile step to an installed Python sibling) until that
extraction path was removed entirely — see
[ADR: the similarity gap-detector](reference/adr/similarity-gap-detector.md);
the algorithmic backend that replaced it is pure computation, so it always ran
natively in both engines anyway, and now there is nothing left to delegate.
The merge-proposal resolver behind [guarded writes](guarded-writes.md) runs
natively in both engines: the Node engine returns the same three-way (and, with
a configured `[models.extraction]` model, LLM) merge proposal on a stale write,
byte-identical to Python's conflict response.


## How parity is proven

Claims here are not promises — they are checked. The shared
`spec/conformance/cases.yaml` runs in both engines' test suites with zero
skips of a claimed case class; a pinned cross-engine scrypt vector makes auth
hashes identical byte-for-byte; and the LanceDB dataset one engine writes is
read by the other in a live interop test. This very page is codumented — its
matrix claims (identical CLIs, no Python in the npm package, LanceDB kept
optional, the Node merge resolver present) are validated on every push, so the
doc cannot quietly drift from the code.


