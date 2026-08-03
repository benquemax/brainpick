# Similarity gaps — the vector-vs-graph cross-check

T3's algorithmic backend derives its graph from links and tags authors
already wrote — proactive, but blind to a connection nobody has written yet.
`similarity-gaps.json` closes that blind spot from the other direction: it
joins [T2](30-t2-vectors.md)'s vectors against [T1](20-t1-artifacts.md)'s
link graph to find document pairs that read as semantically similar but
carry no edge between them, and reports the difference. It is the second of
the two routes that together replace what LLM extraction used to attempt —
see [ADR: the similarity gap-detector](../docs/reference/adr/similarity-gap-detector.md)
for the full reasoning.

`similarity-gaps.json` is **advisory**, the same standing as
[`timeline.json`](90-timeline.md): its layout is normative (both engines emit
the same shape) but its content depends on whichever embedding backend
produced T2's vectors, so it is never itself byte-compared across arbitrary
embedders — only against the deterministic mock embedder in conformance
(spec/30). Consumers MUST tolerate its absence (T2 off, the module off, or a
compile that hasn't run since T2 last changed).

## Generation

At compile time, once [T2](30-t2-vectors.md) reports `fresh` and
[T1](20-t1-artifacts.md)'s `graph.json` is available:

1. Compute one representative vector per non-reserved document: mean-pool
   that document's chunk vectors (arithmetic mean, per dimension) over the
   T2 chunk store.
2. Build an "already linked" set from `graph.json`'s `edges` — the same
   undirected adjacency `islands` already derives (spec/20): a pair with an
   edge in either direction is excluded, regardless of link `kind`.
3. Score every remaining unordered pair of non-reserved documents by cosine
   similarity over their doc vectors (brute-force — bundle sizes here are
   small; no approximate nearest-neighbor index is needed).
4. Keep pairs at or above `[similarity_gaps] threshold`, sort by
   (`-score`, `a`, `b`), and cap at `[similarity_gaps] max_pairs`.
5. Join against `similarity-gaps-allowlist.toml` (below) to mark each kept
   pair `"open"` or `"dismissed"`.

This never blocks compile: any failure (T2 backend error, malformed
allowlist) is caught, logged, and the artifact is simply omitted or left as
it was — the same posture as timeline generation (spec/90).

## t1/similarity-gaps.json (normative layout, advisory content)

```json
{
  "pairs": [
    {"a": "aurinko.md", "b": "maa.md", "score": 0.885, "status": "open"},
    {"a": "komeetta.md", "b": "planeetat.md", "score": 0.812, "status": "dismissed"}
  ],
  "threshold": 0.75,
  "max_pairs": 50
}
```

- `pairs` — sorted by (`-score`, `a`, `b`); each pair's `a < b`
  lexicographically (canonical, undirected — a pair is never listed twice in
  either order). `score` is cosine similarity in `[0, 1]`, rounded to 3
  decimal places. `status` is `"open"` (unresolved — link the pages, or
  dismiss it) or `"dismissed"` (present in the allowlist).
- `threshold`/`max_pairs` echo the config that produced this pass, so a
  consumer can explain why a pair is absent without re-reading
  `brainpick.toml`.
- An empty `pairs` list is valid and fresh: a well-linked wiki genuinely has
  no gaps.

## Config (spec/80)

`[modules] similarity_gaps`: `"auto"` (default — on whenever T2 is fresh, no
extra configuration) | `"on"` (same as `auto` today; reserved for a future
world where T2 being fresh doesn't imply this should run) | `"off"`.
`[similarity_gaps] threshold` (float, default `0.75`) and `max_pairs` (int,
default `50`) tune the pass; both are SHARED bundle policy (`brainpick.toml`,
not machine-local).

## The allowlist — dismissing a reviewed pair

`similarity-gaps-allowlist.toml`, sibling to `brainpick.toml` at the bundle
root, is committed, versioned, curatorial data — not runtime config and not
frontmatter (a dismissal describes a *pair*, not one document or one
setting):

```toml
# similarity-gaps-allowlist.toml — reviewed-and-rejected similarity-gap pairs.
[[dismissed]]
a = "bar.md"        # canonical order: a < b lexicographically
b = "foo.md"
reason = "lexical echo, not a real connection"   # optional, human context
```

A pair present here (in either `a`/`b` order — the reader normalizes before
matching) is written to the artifact with `"status": "dismissed"` and does
not trigger the henxel below. Absent file ⇒ every pair is `"open"`. A
malformed file is warned about and treated as empty — it never fails a
compile (same forgiving posture as an unparseable `brainpick.local.toml`,
spec/80).

## Surfaces

- `GET /api/similarity-gaps` (spec/50) — the artifact, or its empty shape
  when absent.
- `brain_overview()`'s `similarity_gaps_open_count` (spec/70) — the count of
  `"open"` pairs, always present, `0` when off/absent.
- The [AGENTS.md brain report](20-t1-artifacts.md#generated-agentsmd-brain-report-opt-in)
  gains a "top similarity gaps" line, present only when the artifact exists.
- A henxel, `level: warn` (matching the existing "every link lands" nudge),
  reads the compiled artifact and the allowlist, and emits one instruction
  per unresolved `"open"` pair: link the two pages, or add a reasoned entry
  to the allowlist. **This is a real departure from every other henxel in
  this repo**, which all parse markdown directly — this one reads a compile
  *output*, so it is only as current as the last compile with T2 on. A
  stale or absent artifact degrades silently (nothing to warn about), never
  an error.

## Conformance

Class `similarity-gaps` (byte-compare, mirroring `kg-algorithmic`): compile
the fixture bundle with the mock embedder (spec/30) on and default
`[similarity_gaps]` config, and compare the produced `similarity-gaps.json`
byte-for-byte against the golden (regenerated only via
`scripts/regen-golden.py`). The mock embedder is fully deterministic, so — 
unlike an LLM-backed signal — exact scores are legitimate to lock in, not
just pair membership.
