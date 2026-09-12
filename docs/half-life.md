---
type: article
about: concept
title: Half-life
description: Memories fade, and that is a feature — a document's retrieval score is multiplied by 2^(-age/half_life) so a stale page still surfaces but ranks below a fresh one; resolved bundle → folder → frontmatter, off by default, nothing ever deleted.
tags: [brain, tier, config]
timestamp: 2026-09-13T12:30:00Z
---

# Half-life

A brain that remembers everything equally well is not a memory, it is a
filing cabinet. Human memory forgets on purpose: yesterday's journal entry
is vivid, last spring's is a blur, and the skill you practised a hundred
times never fades at all. Brainpick gives [the brain](brain.md) the same
shape with one ranking factor — the **half-life**.

## What it does

Every search retriever — keyword, semantic, graph ([Search
modes](search-modes.md)) — multiplies a document's score by

```
max( 2 ^ (-age / half_life), 1/16 )
```

before it ranks its hits and before the router fuses them. `age` is the time
from the document's OKF `timestamp` to the moment of the query, in days;
`half_life` is the document's effective half-life in days. A page one
half-life old scores half; two half-lives, a quarter. The floor at four
half-lives (1/16) is the point of the design: **nothing is ever deleted,
filtered or hidden** — a faded page is still found and still ranks by
relevance among other faded pages; it only gets harder to recall than a
fresh page that says the same thing. Documents with no `timestamp` never
fade; a future timestamp counts as age zero.

The MCP `why` field says when the factor moved a hit — `body mentions
'kahvi'; faded (30 days old, half-life 1 day)` — so an agent sees not just
where a page ranks but why ([brain_search](reference/mcp/brain-search.md)).

## Where the half-life comes from

The effective half-life resolves per document, most specific wins:

1. `[half_life] default` in `brainpick.toml` — the bundle-wide value.
   Default `0`: **nothing fades unless a brain asks**, so every existing
   bundle ranks exactly as before ([half_life.default](reference/config/half-life-default.md)).
2. `[half_life.folders]` — a table of bundle-relative folder → days; the
   longest folder that is a prefix of the document's path wins, so
   `journals/archive` beats `journals`
   ([half_life.folders](reference/config/half-life-folders.md)).
3. The document's own frontmatter `half_life` (days, `0` = never fades) —
   the author pins a page or lets it go.

The folder table is the bundle author's, not the engine's: brainpick still
interprets no folder name of its own ([Structure
agnosticism](structure-agnosticism.md)). A brain in [format
2](reference/spec/brain-format.md) would typically write

```toml
[half_life]
default = 0
[half_life.folders]
journals = 30      # episodic memory fades in weeks
todo = 14          # an open list is a fresh list
skills = 0         # procedural memory never fades
```

so the [data flow](data-flow-architecture.md) shows in ranking: episodes
fade, distilled knowledge keeps, [skills](skills.md) stay sharp.

## Why a ranking factor

Three designs were on the table: delete or archive old pages at compile
time, filter them out of search, or fade them. Deleting breaks
[grounding](grounding.md) — a claim's source must stay readable. Filtering
turns a temporal hint into a hard wall and needs a second query to reach
past it. Fading keeps every principle intact: the artifacts are still a
pure function of the bundle (the factor lives at query time, keyed on the
OKF `timestamp` the author wrote, never on git or file mtimes), a stale page
is still one search away, and the ranking between two pages that say the
same thing finally has a tiebreaker that means something — recency.

## Determinism and conformance

The factor is deterministic given the bundle, the config and a clock. Tests
and the conformance case `search-keyword-half-life` fix the clock (`now`)
in the case itself; the [REST API](reference/spec/rest-api.md) and MCP use
wall-clock time. With the default config the scores are byte-identical to
an engine without the factor, which is how the existing golden orderings
stay valid.

Configuration: [Configuration reference](reference-config.md). Spec:
[Spec: REST API](reference/spec/rest-api.md) *Half-life*, and `half_life`
in [Spec: T1 artifacts](reference/spec/t1-artifacts.md) (`docs.jsonl`
carries the frontmatter value; the query resolves it).
