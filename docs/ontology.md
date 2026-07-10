---
type: article
about: concept
title: The two-axis ontology
description: Why every page carries two independent fields — type (its document form) and about (its subject's ontological category) — and the philosophy lineage behind the split.
timestamp: 2026-07-10T18:30:00Z
---

# The two-axis ontology

A brain represents the world. Every page in it is a **map** — a document, a
form, an artifact with a genre — of some **territory**: a person, a place, an
idea, a thing that happened. Confusing the map for the territory is the
oldest category error there is, and it is exactly the error a single
frontmatter field invites the moment you ask it to carry both jobs at once.

## The conflation, and why it broke

The first version of this idea used one field — `type` — for everything: a
closed vocabulary meant to describe both what KIND of page you were reading
(a reference table, a decision record) and what the page was fundamentally
ABOUT (a person, an event). It worked as long as every page's form and
subject happened to coincide, which is precisely never guaranteed. Tom's
correction (2026-07-10) named the bug directly: "log/playbook/decision/
reference are DOCUMENT types — a different axis from ontology; perhaps an
`about` field?" He was right, and library science had already proven it: a
catalog record separates **genre/form** headings (biography, textbook,
report) from **subject** headings (the topic) because a biography can be
about a scientist, a war, or a company, and knowing it is "a biography" tells
you nothing about which. The Information Artifact Ontology (IAO) formalizes
the same split as an explicit `is_about` relation between an information
content entity and what it represents — the map is never the territory,
even in a machine-readable ontology.

## The split: form and subject, two closed sets

- **`type` — document FORM (the map).** What kind of page is this?
  `article` (the default — a page that exposes its subject), `decision` (an
  ADR), `playbook` (a how-to), `reference` (a lookup page), `log` (an update
  log). This is genre. It says nothing about what the page covers.
- **`about` — ontological SUBJECT (the territory).** What is this page
  fundamentally about? `person` · `organization` · `place` · `thing` ·
  `event` · `process` · `concept`. This is subject matter. It says nothing
  about how the page is written.

The two fields compose freely and orthogonally: an ADR (`type: decision`)
can be about a `thing` (a technology choice) or a `process` (an ongoing
discipline); a `playbook` can be about a `process` (a recurring procedure)
or an `event` (a one-time runbook for a specific migration). Neither field
constrains the other — that orthogonality is the whole point of splitting
them, and the visual grammar section below makes it literal: COLOR carries
`about`, SHAPE carries `type`, two independent channels for two independent
axes.

## Lineage: this is not invented from scratch

Both trees below descend from a real line of applied-ontology work, not
brainstorming:

- **Aristotle's *Categories*** is the first attempt at exactly this project
  — sorting "what there is" into substance versus its accidents (quantity,
  quality, relation, place, time, ...). `about` is a modern, narrow
  descendant of that substance question: what KIND of thing does this page's
  subject fundamentally belong to?
- **Kinesis vs energeia** (Aristotle, *Metaphysics* Θ) distinguishes an
  incomplete motion aimed at an end — building a house is not "built" until
  it stops — from a complete activity that already IS its end at every
  instant, like seeing. **Vendler's** 1957 verb classes (states, activities,
  accomplishments, achievements) formalized the same split linguistically as
  **telic** (has a natural endpoint) versus **atelic** (doesn't). This is
  exactly the `process` test below: telic if it has a `target_end` (a
  project), atelic if it doesn't (an ongoing practice, a life).
- **BFO** (Basic Formal Ontology, Barry Smith; standardized as ISO 21838)
  draws its top-level split as **continuant** (wholly present at every
  moment it exists — a person, an object) versus **occurrent** (unfolds
  across time, has temporal parts — a process, an event). That is the first
  fork in the `about` tree: happens-as-a-whole or unfolding (occurrents,
  `event`/`process`) versus everything else (continuants).
- **DOLCE** (Descriptive Ontology for Linguistic and Cognitive Engineering,
  Nicola Guarino et al.) splits physical objects into **agentive** (capable
  of intentional action) and **non-agentive**. That is the second fork: does
  it act? — separating `person`/`organization` from `place`/`thing`.
- **FOAF**'s `foaf:Agent` is the standard web-ontology precedent for
  treating `person` and `organization` as siblings under "things that act" —
  an individual agent versus a collective one.
- **OntoClean** (Guarino & Welty) supplies the guard rail: its **rigidity**
  meta-property asks whether a property is essential to every instance at
  every moment, or whether an instance can gain or lose it while remaining
  the same entity. A `person` is rigid — you cannot stop being a person
  without ceasing to exist. A `customer` is not — you can stop being someone's
  customer and still be exactly who you were. Non-rigid properties are
  **roles**, and roles belong in `tags` (objectless: "friend") or `links`
  (roles with an object: "CEO of Acme") — never in `about`.

## The `type` tree

Closed, five values, `article` is the default:

- **`decision`** — an ADR-style record (context, decision, alternatives,
  consequences).
- **`playbook`** — a how-to; a procedure a reader follows.
- **`reference`** — a lookup page: a table, a matrix, an enumerable surface.
- **`log`** — an update log (the bundle's reserved `log.md` stays
  frontmatter-free under OKF and never actually carries this value in
  practice — `log` exists in the set for any OTHER changelog-shaped page).
- **`article`** — everything else: a page that exposes its subject in
  prose. The default, and by far the most common.

## The `about` tree

Closed, seven values, walked in order — the first "yes" wins:

1. **Happens as a whole?** Narrated as a completed or scheduled WHOLE — "it
   took place" — not as something still going. → **`event`**.
2. **Unfolding?** Answers "how is it going?" rather than "did it happen?" —
   **`process`**. Telic (has a `target_end:` — a project) or atelic (no
   endpoint — an ongoing practice, a life). There is deliberately no
   `project` value: a project is a telic process, not a seventh category —
   adding one would duplicate `process` and break OntoClean rigidity (a
   thing does not stop being a project by finishing; it stops being a
   process-in-progress, which `target_end` already encodes).
3. **Acts?** Capable of intentional action. An individual → **`person`**. A
   collective → **`organization`**.
4. **Spatial?** A *where* → **`place`**. A *what* (a physical or digital
   object, an artifact, a tool, a service) → **`thing`**.
5. **Else** → **`concept`**. The residual category: an idea, a mechanism, a
   policy, a pattern — nothing that happens, acts, or occupies space.

Recommended (not yet enforced) per-`about` fields document the subject
further without widening the vocabulary: `event` pages may carry `date:`;
`process` pages may carry `started:` and `target_end:` (present ⇒ telic —
a project).

## Examples, including the counterexamples

| Page | `type` | `about` | Why |
|---|---|---|---|
| This page | `article` | `concept` | Exposes an idea; is not itself a decision, playbook or table. |
| [ADR: LanceDB as the vector store](reference/adr/lancedb-vector-store.md) | `decision` | `concept` | An ADR (form) about an architectural tradeoff (subject) — form and subject differ on purpose. |
| A deploy runbook | `playbook` | `process` | A how-to (form) for a recurring procedure (subject) — atelic, no `target_end`. |
| A recipe | `playbook` | `process` | Same shape as the runbook above: a procedure. |
| **Counterexample: dinner** | `article` | `event` | The MEAL itself (not the recipe) is a completed whole — "we had dinner" — the event `about`, told as an ordinary page. |
| A biography of a scientist | `article` | `person` | Genre-vs-subject textbook case: "biography" (form, here `article`) says nothing about who; `about: person` does. |
| [The daemon](daemon.md) | `article` | `thing` | A running service — an artifact with identity, not narrated as an unfolding activity. |
| [Live deltas](live-deltas.md) | `article` | `process` | A continuous streaming mechanism — genuinely atelic, "how is it going" fits; not a fixed artifact. |
| **Counterexample: "customer"** | — | — | Not a type at all. A customer can stop being a customer without ceasing to exist (OntoClean rigidity fails) — it is a role: a `tag` if objectless, a `link` ("customer of Acme") if it names the other party. |
| **Counterexample: "CEO"** | — | — | Same failure as customer — a role, expressed as a `link` ("CEO of Acme"), never as `about`. |

## `tags` vs `links`, one more time

`tags` are relevance — open-curated, objectless. `links` are relations —
roles WITH an object, like a "CEO of" link to the company's own page. The
[knowledge graph tier](knowledge-graph-tier.md)'s algorithmic backend turns
both into entities (tags become **tag** entities, links that land nowhere
become **ghost** entities), so the type/about split reaches the graph the
same way everything else in `docs/` does — through what the pages already
say, not through a second parallel taxonomy.

## Visual grammar

Decided alongside the fields, implemented later (a lens chunk): **COLOR
encodes `about`, SHAPE encodes `type`** in every graph view. Orthogonal
fields get orthogonal visual channels — the entity layer's diamond markers
already prove shape-coding reads cleanly at a glance; this extends the same
technique across the whole typed brain.

See [wiki conventions](wiki-conventions.md) for the practical, day-to-day
classification guide (the same trees, written for someone actually writing a
page), and [ADR: the two-axis ontology](reference/adr/two-axis-ontology.md)
for the decision record — context, alternatives considered, consequences.
