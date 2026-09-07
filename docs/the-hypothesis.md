---
type: article
about: concept
title: The hypothesis
description: "The bet brainpick is built on — a small model with frictionless access to knowledge and skills that evolve in real time becomes a self-improving agent that outperforms a large model without such access, at a fraction of the VRAM, compute and energy; the sub-hypothesis that the graph must be regenerated from the repository so associations evolve and knowledge is always rebased; why the brain format is what makes outside memory trustworthy, and how the bet gets tested."
tags: [brain, design, vision]
timestamp: 2026-09-07T18:30:00Z
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

## Sub-hypothesis: generate the graph from the repository

The knowledge graph must be a **derived artifact regenerated from the
repository**, never an accumulated store. Everything under `.brainpick/` is
compiled from the files and disposable ([Spec: overview](reference/spec/overview.md));
`brainpick compile --full` ([compile](reference/cli/compile.md)) or plain
`rm -rf .brainpick/` rebuilds it from nothing, and doing so on a schedule —
once a week from scratch — is a habit, not a recovery.

Two things follow that an accumulating store cannot offer:

- **Associations evolve.** When a doc is distilled, split, merged or
  corrected, its links, backlinks, vectors and entities are recomputed from
  what the repository says *now* ([Compile pipeline](compile-pipeline.md)).
  A hand-tended index, an incrementally fed vector database, or weights
  fine-tuned on last month's facts each carry every stale association
  forward; a regenerated graph carries none.
- **Knowledge and skills are rebased.** Because the brain is a repository,
  what the LLM reads is always rebased onto the current state — pulled,
  diffed, reverted, merged like code — and the agent gets that
  frictionlessly, without a retraining or a re-indexing step it has to
  remember to run. This is [principle 2](https://github.com/benquemax/brainpick/blob/main/README.md)
  (the files are the brain) and [principle 4](https://github.com/benquemax/brainpick/blob/main/README.md)
  (agents never tend the index) seen from the hypothesis's side.

## What would falsify it

The hypothesis is testable and meant to be tested: the same tasks, a small
model with a brain against a large model without one, measured in outcomes
and in watt-hours. It fails if the small model, even with a living brain,
cannot *use* what it reads — if reasoning, not knowledge, was the
bottleneck all along. It also fails if the brain cannot stay trustworthy
under agent writes, which is why every layer of the stack that guards
trust (henxels, grounding, the data flow) exists before any that adds
cleverness. The sub-hypothesis fails on its own if a regenerated graph
turns out *worse* than an accumulated one — if associations the compile
cannot recover from the files (a curator's judgement, say) matter more
than the stale ones regeneration sheds. Results belong in this wiki when they exist; until then this
page is the bet, stated plainly, per [Wiki conventions](wiki-conventions.md).
