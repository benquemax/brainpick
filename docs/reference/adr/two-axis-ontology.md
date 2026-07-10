---
type: decision
about: concept
title: "ADR: the two-axis ontology"
description: "Why every page carries two independent fields — type (document form) and about (ontological subject) — instead of one conflated vocabulary, and why process replaces a hardcoded project type."
timestamp: 2026-07-10T18:00:00Z
---

# ADR: the two-axis ontology

**Context.** The wiki's `type` frontmatter field started as one closed
vocabulary doing two jobs at once: describing a page's document FORM
(concept, reference, decision, playbook) and, in an earlier proposal,
also constraining what the page was ontologically ABOUT (person, place,
event, ...). Tom's own instinct caught the bug before it shipped: "log/
playbook/decision/reference are DOCUMENT types — a different axis from
ontology; perhaps an `about` field?" He was right. A biography is a
`type` (a genre) that says nothing about whether its subject is a
scientist or a company; an ADR is a `type` that can be about a technology
choice or an ongoing practice. One field cannot carry both a page's form
and its subject without silently forcing them to coincide.

**Decision.** Split into two independent, closed, henxels-enforced
fields — [the full reasoning and lineage lives in the wiki itself](../../ontology.md),
not just in this record:

- `type` — document FORM: `article` (default) | `decision` | `playbook` |
  `reference` | `log`.
- `about` — ontological SUBJECT: `person` | `organization` | `place` |
  `thing` | `event` | `process` | `concept`.

`process` absorbs what would otherwise be a `project` type: a project is
a *telic* process (it has a `target_end`), not a seventh ontological
category. Keeping `project` out avoids a category that would duplicate
`process` and fail OntoClean's rigidity test — a thing does not stop
being a `process` by finishing; `target_end` already encodes the
distinction that matters.

**Alternatives considered.**

- *One conflated vocabulary* (the status quo this ADR replaces). Rejected:
  proven broken the moment a page's form and subject diverge, which is
  the common case, not the exception.
- *A hardcoded global ontology* shipped once for every brainpick wiki.
  Rejected: this dogfood's own four original types (concept/reference/
  decision/playbook) are document-ROLES, while a person/place/event
  vocabulary is ontological — two different axes, and a single fixed
  global set would break any wiki whose subject domain doesn't fit it.
  The per-wiki declared vocabulary (already how `type` worked) stays the
  mechanism; `about` just adds a second, orthogonal declared set.
- *`project` as an eighth `about` value.* Rejected per the rigidity
  argument above — `process` plus `target_end` already says everything
  `project` would, without adding a category whose membership can
  silently flip mid-life.

**Consequences.** Two closed sets are easier for a small model to reason
about than one conflated set, and each carries its own decision tree as
the henxels rejection message — the rejection IS the classification
manual, consulted the moment a page is misclassified. The whole existing
`docs/` bundle needed a one-time migration (mechanical for the type
mapping, per-page judgment for `about` — see
[Wiki conventions](../../wiki-conventions.md)). The split also unlocks a
visual grammar for the graph UI (COLOR = `about`, SHAPE = `type`,
orthogonal channels for orthogonal fields) and, later, typed search and
typed neighbors — the payoff a single conflated field could never cleanly
offer. Back to [Architecture decision records](../../reference-adr.md).
