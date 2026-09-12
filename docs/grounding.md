---
type: article
about: concept
title: "Grounding"
description: "Every claim in a brain's knowledge and skills says where it came from — inline, Wikipedia-style, with a plain link to a journal entry, an external page, another brain, or an admitted assumption — so the kind of source is readable at the claim and provenance never needs a citation template or a frontmatter key."
tags: [brain-format]
timestamp: 2026-09-13T12:00:00Z
---

# Grounding

A [brain](brain.md) is only as trustworthy as its sources, and an agent
reading it must be able to tell, at every claim, whether the information
came from a decision, from a web page, or from someone's assumption. That is
**grounding**: every claim in `knowledge/` and `skills/` carries a source,
inline, where the claim is made.

## Wikipedia-style, without the ceremony

The model is Wikipedia's — a reference at the sentence, not a bibliography
at the end — but the mechanism is just a markdown link. No citation
template, no `sources:` frontmatter key. Frontmatter is for keys a
*machine* consumes; provenance is read by whoever is reading the claim, so
it lives in the prose next to the claim.

What matters is the **kind** of source, and the link target carries that by
construction:

| Link target | Source kind | Reads as |
|---|---|---|
| a journal day (`../journals/archive/2026/09/2026-09-07.md`; a month-file section `../journals/2026-09.md#2026-09-07` under format 1) | a decision or observation this brain made | "we decided / we saw" |
| raw material (`../raw/customer-call-2026-09-07.md`) | a source this brain holds but does not compile | "the transcript says" |
| an external URL | a page outside the brain | "according to" |
| another brain (`brain://…`) | knowledge that lives closer to its implementation | "the project brain says" |
| nothing, and the text says so | an admitted assumption | "assumed", "untested" |

The fourth row is not a loophole; it is the honest case. A claim with no
source is fine as long as it *says* it has none — what is forbidden is a
confident sentence with an unmarked origin.

## Who needs grounding

- `knowledge/` and `skills/` — always. They are the distilled layers of the
  [Data flow architecture](data-flow-architecture.md), and distillation
  without provenance is how a brain drifts from what actually happened.
- `journals/` — never. Journal entries *are* the primary sources; they
  record what happened and link forward to what they changed.
- `raw/` — never, and it needs no links at all. It is source material, kept
  orderly and greppable precisely so the layers above can point at it.
- `vision/` and `plans/` — as far as they make claims. A vision may be
  unfounded by nature; a plan that rests on a fact links to it.

## How the contract enforces it

The henxels contract in [The brain template](brain-template.md) uses the
OKF orphan rule (`min_outbound_links`) on `knowledge/` and `skills/`: a doc
with zero outbound links is not just an orphan in the graph, it is an
ungrounded page, and the check fails rather than warns. That is a coarse
gate — it cannot tell a real source from a decorative link — and it is
meant to be: the fine judgment belongs to the reader and to the agent that
writes the page, which the template's first skill instructs to ground every
claim it adds.

## Grounding and the graph

Grounding links are edges. Every inline source a knowledge page cites
becomes a link brainpick's [Knowledge graph tier](knowledge-graph-tier.md)
sees, and every `brain://` source is a cross-brain edge that
[Federation](federation.md) can one day follow. A well-grounded brain is a
well-connected brain — the two are the same property seen from two sides.
