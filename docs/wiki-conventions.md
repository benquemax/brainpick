---
type: playbook
about: concept
title: Wiki conventions
description: How concepts in this wiki are written, typed and linked — including the practical, day-to-day guide to classifying type and about — and why this wiki doubles as brainpick's dogfood corpus.
timestamp: 2026-07-10T18:00:00Z
---

# Wiki conventions

One concept, one kebab-case markdown file, with OKF frontmatter: `type` and
`about` are both MUST fields here; `title`, `description` and `timestamp`
keep a page findable and compilable. The `description` matters more here
than in most wikis — it is the one-sentence summary that the
[compile pipeline](compile-pipeline.md) will lift into the generated index
and that agents see first in every search result.

## Classifying a page: two questions, in order

Every page answers two independent questions. Answer `type` first (it is
usually obvious), then `about` (the one that needs real judgment).

**1. What FORM is this page?** (`type` — the map)

| Value | Is it... |
|---|---|
| `article` (default) | a page that exposes its subject in prose — most pages |
| `decision` | an ADR-style record (context, decision, alternatives, consequences) |
| `playbook` | a how-to a reader follows, like this page |
| `reference` | a lookup page — a table, a matrix, an enumerable surface |
| `log` | an update-log-shaped page (the bundle's own reserved `index.md`/`log.md` stay frontmatter-free and never carry this) |

**2. What SUBJECT is this page fundamentally about?** (`about` — the
territory). Walk this tree in order — the first "yes" wins:

1. **Happens as a whole?** Narrated as a completed or scheduled WHOLE —
   "it took place" — not as something still going. → `event`.
2. **Unfolding?** Answers "how is it going?" rather than "did it happen?"
   → `process`. Telic if it has a `target_end` (a project), atelic if it
   doesn't (an ongoing practice).
3. **Acts?** An individual agent → `person`. A collective → `organization`.
4. **Spatial?** A *where* → `place`. A *what* (an object, artifact, tool,
   service) → `thing`.
5. **Else** → `concept` — an idea, mechanism, policy or pattern.

The full reasoning and philosophical lineage behind both trees — Aristotle's
*Categories*, Vendler's telic/atelic verb classes, BFO's continuant/
occurrent split, DOLCE's agentive/non-agentive split, FOAF's `Agent`,
OntoClean's rigidity test — lives on [the two-axis ontology](ontology.md)
page; this page is the quick-reference version for someone actually writing.

## Examples and counterexamples

| Page | `type` | `about` | Why |
|---|---|---|---|
| [ADR: LanceDB as the vector store](reference/adr/lancedb-vector-store.md) | `decision` | `concept` | Form and subject differ on purpose — an ADR ABOUT an architectural tradeoff. |
| A deploy runbook | `playbook` | `process` | A how-to for a recurring, atelic procedure. |
| A recipe | `playbook` | `process` | Same shape: a procedure, not a specific meal. |
| **Counterexample — dinner itself** | `article` | `event` | The MEAL (not the recipe) is a completed whole: "we had dinner." |
| A biography | `article` | `person` (or `organization`) | "Biography" is the form; it says nothing about who the subject is — `about` does. |
| [The daemon](daemon.md) | `article` | `thing` | A running service, described as an artifact with identity — not narrated as an event. |
| [Live deltas](live-deltas.md) | `article` | `process` | A continuous streaming mechanism — atelic, "how is it going" fits. |
| **Counterexample — "customer"** | — | — | A role, not a type: you can stop being someone's customer without ceasing to exist (fails OntoClean rigidity). Use a `tag` (objectless) or a `link` (with the object) — never `about`. |
| **Counterexample — "CEO"** | — | — | Same failure — express as a link ("CEO of ...") to the organization's own page, never as `about`. |

## Per-`about` recommended fields (documented, not yet enforced)

- `about: event` pages may carry `date:`.
- `about: process` pages may carry `started:` and `target_end:` — presence
  of `target_end` marks it telic (a project).

## `tags` vs `links`

`tags` are relevance — open-curated, objectless ("friend", "governance").
`links` are relations — roles WITH an object ("CEO of" a specific
organization page). If a candidate tag names a relationship TO something
specific, it almost always wants to be a link instead; if it's a bare
label with no other party, it's a tag.

## Linking, indexing, ghosts

Link relatively, and make the link text the target's title — the text
survives markup stripping as a clean entity mention when the
[knowledge graph tier](knowledge-graph-tier.md) extracts over this corpus.
Every page links out at least once: a concept is a node in
[the tiers](the-tiers.md)' T1 graph, not an island. New top-level concepts
are listed in the index, and notable changes get a dated entry in the update
log, newest first.

A link that lands nowhere is either a mistake or intentional: a typo or a
wrong path should be fixed or removed on the spot, but a page this wiki
genuinely wants yet to grow gets left as a **ghost** — the algorithmic
knowledge-graph backend turns it into a ghost entity, and
[the daemon](daemon.md)'s brain report can surface the most-referenced
ghosts as a standing write-next list. The henxel that checks this only
warns, never blocks — never leave a link you didn't mean, but don't let
that stop you writing toward one you do.

## Tags as light entity structure

A modest, reused vocabulary of frontmatter `tags` (1–3 per page — think
`tier`, `ui`, `agents`, `governance`, `spec`, `desktop`, `engine`, and a
few narrower ones for the reference volume's own sub-areas) turns into
**tag entities** in the same algorithmic knowledge graph, giving the
otherwise link-only T3 layer real subject clusters to show. Prefer reusing
an existing tag over minting a new one-off — the vocabulary's value is in
its repetition.

## This wiki is also test mass

It is the first bundle brainpick compiles, serves and visualizes, so write
generously — every feature lands with its concept page, and the corpus is
meant to grow until the interface sweats.
