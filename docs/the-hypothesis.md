---
type: article
about: concept
title: The hypothesis
description: "The bet brainpick is built on — a small model with frictionless access to knowledge and skills that evolve in real time becomes a self-improving agent that outperforms a large model without such access, at a fraction of the VRAM, compute and energy; the sub-hypothesis that associations are made by the author at write time under the contract and the graph derived from them, not extracted retroactively by a model as LightRAG does; why the brain format is what makes outside memory trustworthy, and how the bet gets tested."
tags: [brain, design, vision]
timestamp: 2026-09-07T20:00:00Z
---

# The hypothesis

Brainpick's principles say *small models are first-class citizens*. This
page is the reason: a hypothesis about where intelligence should live.

## The claim

Give an agent powered by a small model **frictionless access to knowledge
and skills that evolve in real time**, and you get a self-improving agent
that is not only as capable as an agent on a large, powerful LLM, but
*better* — provided the large LLM does not have the same frictionless,
evolving access. What a large model knows was fixed at training time and is
opaque even to itself; what a [brain](brain.md) knows is corrected the
moment any agent using it notices a flaw, and every claim in it says where
it came from ([Grounding](grounding.md)).

## The architecture it implies

Keep *sufficient* intelligence inside the model — reading, reasoning, tool
use — and keep knowledge and skills **outside** it, in a brain that agents
read, ground and improve as they work. Three consequences follow:

- **Less VRAM and compute.** Skills and facts are not baked into weights,
  so the model running them can be a 27B on your own machine
  ([Embedding detection](embedding-detection.md) and the
  [tiers](the-tiers.md) are sized for exactly that). Learning something
  new is a commit, not a fine-tune.
- **A better and more up-to-date world understanding.** A brain is
  corrected in real time by every agent that uses it and refereed on every
  write ([Henxels contract reference](reference-henxels.md)); a large
  model's understanding is as old as its cut-off.
- **More intelligence per kWh.** The same task done by a small model over a
  living brain costs a fraction of the energy of a frontier model
  rediscovering the answer — and the second time it is a skill, not a
  rediscovery at all.

## Why the brain format is the load-bearing part

Outside memory only replaces weights if it can be *trusted* as much as
weights, and read as *cheaply*. That is what the brain format is for:

- The [Data flow architecture](data-flow-architecture.md) distils episodes
  into knowledge into skills, so what an agent reads first is the most
  tested, purest form the brain holds — and reading a less distilled layer
  is an instruction to distil.
- [Grounding](grounding.md) makes every claim auditable inline; a model
  cannot show its sources, a brain must.
- The contract ([The brain template](brain-template.md)) refuses ungrounded,
  unlinked or malformed writes, so the brain cannot rot the way a prompt
  file does.
- [Brain subsidiarity](brain-subsidiarity.md) lets the closest brain win, so
  a project's own memory beats a general one — the opposite of a single
  model's single view.
- Retrieval is compiled ([Compile pipeline](compile-pipeline.md)) and served
  in a handful of tools ([MCP tools](mcp-tools.md)) small enough for a small
  model to drive: the model never has to *remember*, only to *look*.

## Sub-hypothesis: associations are made at write time

The associations in a knowledge graph should be made **by the author, at
the moment of writing** — not extracted afterwards by a model. An agent
writing to a brain already has the relevant pages in its context: it just
read them to ground what it is about to say ([Grounding](grounding.md)). So
the associations come for free — it links the pages and tags the doc — and
the contract refuses the write if it did not ([Henxels contract
reference](reference-henxels.md): every link lands, no orphans, frontmatter
is the one MUST).

The graph is then *derived* from what the files carry, algorithmically, on
every commit, in under a second ([Compile pipeline](compile-pipeline.md)):

- **T1** — the doc graph from the links the author wrote: backlinks, tags,
  orphans, ghosts ([The tiers](the-tiers.md)).
- **T3** — the entity/relation graph from tags and ghosts
  ([Knowledge graph tier](knowledge-graph-tier.md),
  [Spec: T3 knowledge graph](reference/spec/t3-kg.md)).
- **T2** — vectors for the semantic connections nobody wrote
  ([Search modes](search-modes.md)), and the
  [Similarity gap-detector](similarity-gap-detector.md) joining T2 against
  T1 to flag pages that *should* be linked — cumulatively, at zero model
  cost.

Knowledge accumulates in the repository, commit on commit; a page written
today is linked from pages written a year ago the moment it is compiled;
a correction corrects every association through it. That is what puts the
latest knowledge and skills in front of the LLM frictionlessly: pull,
compile, read.

Compare the widely used LLM-extracted graphs — LightRAG, GraphRAG. A model
reads the corpus *retroactively*, without the author's context, to guess at
associations the author already had. That is expensive enough to run once
in a while, so the graph is outdated from day one; and because every pass
re-derives from zero, the graph never *credits* what the brain already knew
— nothing an agent learns today makes tomorrow's graph better. Such a graph
is a snapshot of the brain, not a part of it. Brainpick ran LightRAG early
on and retired it for exactly this reason
([ADR: the similarity gap-detector](reference/adr/similarity-gap-detector.md),
[ADR: the KGBackend adapter](reference/adr/kgbackend-adapter.md)). There is
no LLM extractor in the mix: `modules.graph.backend = "lightrag"` is only
recognised as a removed value that falls back to algorithmic
([modules.graph](reference/config/modules-graph.md)).

This is, knowingly, reinventing the knowledge graph — on the premise that
the associations belong in the files, made by whoever knows them best at
the moment they are known, under a contract that will not let them be
skipped. A model's contribution counts only when it lands in the files.

## What would falsify it

The hypothesis is testable and meant to be tested: the same tasks, a small
model with a brain against a large model without one, measured in outcomes
and in watt-hours. It fails if the small model, even with a living brain,
cannot *use* what it reads — if reasoning, not knowledge, was the
bottleneck all along. It also fails if the brain cannot stay trustworthy
under agent writes, which is why every layer of the stack that guards
trust (henxels, grounding, the data flow) exists before any that adds
cleverness. The sub-hypothesis fails on its own if a graph extracted
retroactively by a model answers better than the one authors built as they
wrote — if the associations authors miss, even under the contract and with
the gap-detector prompting them, matter more than being current and cheap. Results belong in this wiki when they exist; until then this
page is the bet, stated plainly, per [Wiki conventions](wiki-conventions.md).
