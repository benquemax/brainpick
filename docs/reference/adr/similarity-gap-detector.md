---
type: decision
about: concept
title: "ADR: the similarity gap-detector"
description: "Why a vector-vs-graph cross-check replaces LLM extraction as T3's second signal — cumulative and free, where extraction re-derived the whole graph from zero every pass."
tags: [graph]
timestamp: 2026-08-03T00:00:00Z
---

# ADR: the similarity gap-detector

**Context.** [The KGBackend adapter](kgbackend-adapter.md) fenced LightRAG
behind an install extra so its churn stayed contained, but containing a cost
is not the same as the cost being worth paying. LightRAG's batch extraction
re-derives the whole entity graph from zero on every full pass — no memory of
a prior run, no credit for pages that are already well-connected, cost scaling
with corpus size regardless of how much of that corpus a human (or a writing
agent) has already governed with real links. On this repo's own dogfood wiki,
extracted entities converged on little more than the pages themselves — a
real signal that the model was doing work the links had already done. LightRAG
never earned its keep here, and nothing suggested it would elsewhere on a
similarly governed corpus.

**Decision.** Two complementary routes replace what LLM extraction tried to
do in one step, together rather than either alone:

1. **Route 1 — write-time discipline (already existed, unchanged).** The
   henxels contract nudges linking as pages are written: `min_outbound_links`
   keeps every concept connected to the graph, and `links_resolve` (warn-level)
   keeps every link honest. This makes the explicit link graph
   *self-maintaining* — it accumulates as pages are written, never re-derived
   from scratch, and every past linking decision stays exactly as valid as the
   day it was made.
2. **Route 2 — the vector-similarity gap-detector (new, spec/45).** The
   vectors [the tiers](../../the-tiers.md) already computes for semantic
   search are joined against the explicit link graph in one cheap pass:
   mean-pool each document's chunk vectors,
   score every unlinked pair by cosine similarity, keep what clears a
   threshold. This is the read LightRAG's extraction pass was trying to
   provide — "what should connect that doesn't yet" — at zero model cost,
   computed fresh every compile from data that already exists.

Neither route repeats work on pages that are already well-connected: route 1
never re-examines a link once it exists, and route 2's cost is a cosine join
over what T2 already computed, not a corpus-wide re-read. A reviewed pair is
remembered permanently via the dismiss/allowlist mechanism (below), so the
same "not related" judgment is never asked twice.

**The allowlist, and why it lives where it does.** A warn-level nag that never
stops is worse than no nag — it trains reviewers to ignore the whole check,
the same failure mode henxels already avoids elsewhere by keeping
`links_resolve` at `warn`, not `block`. `similarity-gaps-allowlist.toml`,
sibling to `brainpick.toml`, records a reviewed-and-rejected pair permanently.
It is deliberately its own file, not a table inside `brainpick.toml` and not
frontmatter on either document: a dismissal is curatorial review data (a
human decided "not a real connection"), not runtime configuration, and it
describes a *pair* — putting it on one document's frontmatter would force an
arbitrary owner between the two.

**Alternatives considered.**

- *Keep LightRAG as the opt-in "richer" backend.* Rejected — see Context: it
  never earned its cost on a governed wiki, and maintaining a second backend
  behind the adapter for a case that never paid off isn't worth the surface
  area, especially against this project's own thesis that the files, not an
  extraction pass, are the brain.
- *Route 2 alone, with no allowlist.* Rejected — a pair that is genuinely not
  worth linking would nag on every commit forever, training reviewers to
  ignore the check entirely (the exact failure this ADR's allowlist design
  exists to prevent).
- *Fold dismissals into `brainpick.toml`.* Considered seriously — zero new
  file, zero new parsing. Rejected: `brainpick.toml` mixes operational
  settings (`[serve] port`, `[models.embedding]`) that an ops-minded edit
  touches with curatorial decisions a content reviewer touches; cramming both
  in one file means unrelated diffs collide, and `git log` can no longer
  isolate "what has this bundle decided not to link" on its own.

**Consequences.** T3 stays algorithmic-only — see the rewritten
[ADR: the KGBackend adapter](kgbackend-adapter.md), which now frames the
`KGBackend` seam as a test/mock hook rather than LightRAG's home.
`[models.extraction]` keeps exactly one live consumer: `brain_write`'s merge
resolver ([Spec: MCP tools](../spec/mcp-tools.md)). A new advisory artifact
(`t1/similarity-gaps.json`, [spec/45](../spec/t3-kg.md)) and a new henxel
exist that no prior tier had — and this henxel is a genuine departure from
every other check in this contract: it reads a *compiled artifact*, not
markdown directly, so it is only as current as the last `brainpick compile`
with T2 on, and degrades silently (never an error) when that artifact is
stale or absent. Dogfooding this repo's own `docs/` wiki (T2 already fresh
here) surfaced real, sensible candidate pairs immediately — proof the
approach works on real prose, not just a fixture. Back to
[Architecture decision records](../../reference-adr.md).
