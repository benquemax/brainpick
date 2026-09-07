---
type: article
about: concept
title: "The brain"
description: "A brain is a wiki meant to be an agent's memory — an OKF bundle with memory-type folders, a declared data flow architecture, inline grounding, an audience and an identity other brains can address; what makes it more than a wiki, and what brainpick does with the difference."
tags: [brain-format]
timestamp: 2026-09-07T18:00:00Z
---

# The brain

A **wiki** is a collection of information. A **brain** is a wiki that is
meant to be the memory of an agent. brainpick serves any well-formed OKF
bundle — the engine does not care — but a brain is the shape brainpick
*recommends*, and the shape the henxels `brainpick-brain` starter template
produces (see [The brain template](brain-template.md)). The contract is
[Spec: brain format](reference/spec/brain-format.md); this page is the why.

A brain is also the load-bearing part of [The hypothesis](the-hypothesis.md):
knowledge and skills outside the model, evolving in real time, so the model
can be small.

## What makes it a brain

Four things, and each one is a rule the template enforces:

1. **Folders are memory types.** `_brain/` holds five memory types, each
   with one job: `knowledge/` (semantic — evergreen concepts), `skills/`
   (procedural — distilled, actionable procedures), `journals/` (episodic —
   one file per month, a dated section per day), `vision/` (direction — the
   northstar as a book), `plans/` (decided work) — plus `raw/`, which is not
   a memory type but the undistilled source material knowledge grounds on,
   kept greppable and excluded from the compiled brain. Nothing is
   replicated across layers; a doc lives in exactly one memory type.
   Project management that is neither knowledge nor an episode —
   `_todo.md`, scratch in `_temp/` — stays *beside* the brain.

   The folders are the template's, not brainpick's: brainpick reads
   frontmatter and reserved names only ([Structure agnosticism](structure-agnosticism.md)),
   so the layout can evolve without breaking a brain born earlier.
2. **A declared data flow.** Episodes become knowledge become skills, and
   retrieval runs the other way. This is the
   [Data flow architecture](data-flow-architecture.md), and it is what turns
   a pile of pages into memory.
3. **Grounding.** Every claim in `knowledge/` and `skills/` says where it
   came from, inline, with a plain link — a journal entry, an external page,
   another brain, or an admitted assumption. See [Grounding](grounding.md).
4. **Identity and audience.** A brain knows who it is written for
   (`[brain] audience`: personal, team, public — see
   [brain.audience](reference/config/brain-audience.md)) and can be addressed
   by other brains through its `[bundle] id` — the basis of
   [Brain subsidiarity](brain-subsidiarity.md), which decides what happens
   when two brains disagree.

## The brain is not the truth

The most important sentence in the template's first skill: **the brain is
the best knowledge available at the moment, not the truth.** Everything in
it is provisional, and an agent's job when it notices a flaw is to fix the
brain — correct the page, add the pointer, promote the journal entry — not
to route around it. A brain that is only read decays; a brain that is
improved on every use compounds. brainpick's
[Guarded writes](guarded-writes.md) exist so that improving is as cheap as
reading while the contract still referees every change.

## Why `_brain/` and not `_wiki/`

Because the name carries the opinion. A folder called `_wiki/` promises
information; a folder called `_brain/` promises the five memory types, the
data flow, grounding and an audience — and once other brains link into it
(`brain://…/knowledge/foo.md`), the name is part of the address. It is
fixed on purpose, and [The brain template](brain-template.md) explains what
else is fixed, what is cheap to change, and how a later format version
migrates.

## Where brainpick meets the brain

- A bundle declares itself a brain with `[brain] format = 1` in the shared
  `brainpick.toml` ([brain.format](reference/config/brain-format.md)); both
  engines read the section today. Having `brainpick init` recognise `_brain/`
  and write it unasked is the next step on [Onboarding](onboarding.md).
- The spec asks `brain_overview` to list `type: playbook` docs first — the
  read order of the data flow ([MCP tools](mcp-tools.md)); today the overview
  groups by folder alphabetically, and the ordering is a pending engine step.
- Freshness is the reader's job today: the first skill says *pull before you
  read, push after you write*. Having the engine notice a stale checkout
  (a `brain_overview` line: "behind origin by N commits") is a candidate
  follow-up, keyed on git, never on layout.
- [Federation](federation.md) is how several brains — a project's, a team's,
  your personal one — answer one search, which is where subsidiarity starts
  to matter.
- The compile pipeline's freshness gate keeps the compiled artifacts honest
  before every commit ([Compile pipeline](compile-pipeline.md)) — stale
  artifacts lie to agents.
