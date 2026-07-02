---
okf_version: "0.1"
---

# The brainpick brain

Brainpick's own documentation, kept as an OKF bundle — the first brain
brainpick ever compiles is this one. Concepts carry `type`, `title`,
`description` and `timestamp` frontmatter; links are relative and their text
is the target's title.

## Concepts

* [The tiers](the-tiers.md) - the four-tier retrieval ladder where every tier is optional except the files
* [Artifact spec](artifact-spec.md) - the runtime-neutral format under `.brainpick/` that both engines must honor
* [Compile pipeline](compile-pipeline.md) - staged, hash-incremental compilation with watch mode and a freshness gate
* [Live deltas](live-deltas.md) - the SSE protocol that keeps every open brain view current without a refresh
* [MCP tools](mcp-tools.md) - the five agent-facing tools and their small-model ergonomics
* [Search modes](search-modes.md) - keyword, semantic, graph and auto-fusion retrieval with honest degradation
* [Guarded writes](guarded-writes.md) - the henxels-refereed write path for remote agents
* [Runtime parity](runtime-parity.md) - the capability matrix between the pip and npm engines
* [Knowledge graph tier](knowledge-graph-tier.md) - LightRAG-backed entity extraction behind an adapter and a neutral export
* [Embedding detection](embedding-detection.md) - the backend ladder that makes vectors work without interrogation
* [Holographic brain](holographic-brain.md) - the signature visualization: an anatomical brain you spin, pinch and morph
* [Onboarding](onboarding.md) - one command from zero to a living brain
* [Wiki conventions](wiki-conventions.md) - how concepts in this wiki are written and linked
