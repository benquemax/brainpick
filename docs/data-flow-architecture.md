---
type: article
about: concept
title: "Data flow architecture"
description: "How information moves through a brain — episodes in the journal distil into evergreen knowledge and then into actionable skills, retrieval runs the mirror path from most distilled to least, and each layer points upward instead of repeating — the principle that makes a brain memory rather than a pile of pages."
tags: [brain-format]
timestamp: 2026-09-12T16:40:00Z
---

# Data flow architecture

The **data flow architecture** of [the brain](brain.md) is the rule for
which direction information moves between its memory types, and which
direction an agent reads it. The two directions are mirrors of each other,
and that symmetry is the whole design.

## The write path: distillation

```
raw/  ──►  journals/  ──►  knowledge/  ──►  skills/
source     episodic        semantic          procedural
"as found"  "what happened" "what is true"    "what to do"
```

Before an episode there may be **raw material** — a transcript, an export,
a clipping dropped into `raw/`. It is kept greppable for grounding and
distillation but excluded from the compiled brain, because it is noisy by
nature. Information enters the brain proper as **episodes**: a journal entry that
records what was tried, decided or observed. When an episode (or several)
settles into something evergreen — a fact, a mechanism, a tradeoff — it is
**distilled** into a `knowledge/` concept page. When knowledge becomes a
procedure that has been carried out and works, it is distilled once more
into a `skills/` doc: actionable, tested, ready to follow.

Each step *reduces* the text and *raises* its reliability. A skill is the
purest form the brain holds: it has survived being knowledge and being
applied.

`vision/` and `plans/` sit beside this pipeline rather than in it: vision is
where the brain is going, plans are decided work. Both are retrievable and
both are grounded, but nothing distils *into* them — they are inputs, the
journal records what came of them.

## DRY by pointer, upward

When a more distilled doc is written, the less distilled one it came from
gains a **pointer** to it — "now covered by [skill]" — not a copy. Journal
entries point forward to the knowledge or skill they changed and never
restate it (rule 12 of the template contract: *the journal points to
changes, never replicates them*). Knowledge pages point to the skill that
operationalises them. Every layer is therefore a navigable step toward the
next, and the brain stays DRY in the direction of distillation: the
distilled doc is the one place the fact lives, and everything below it
says where to look.

The pointer runs the other way too, as provenance: a knowledge page links
inline to the journal entries it was distilled from, a skill to the
knowledge it assumes. That downward link is what [Grounding](grounding.md)
requires, and together the two directions give the graph an orientation
that brainpick's [Knowledge graph tier](knowledge-graph-tier.md) can read.

## The read path: most distilled first

```
skills/  ──►  knowledge/  ──►  journals/  ──►  (grep raw/)
```

An agent looking for an answer reads in the **reverse** order of the write
path: skills first, because a skill is the most actionable, tested and pure
form the brain has; then knowledge, for the concept behind the skill or a
fact no skill covers yet; then the journals, for episodes when nothing
distilled exists; and `raw/` only by grep, to check a source or to distil
something new. With several brains, the closest brain comes before any of
this — see [Brain subsidiarity](brain-subsidiarity.md).

Before any of it: **pull.** A brain is shared memory in Git — other agents
and people commit to it between sessions — so the read path starts with
`git pull` in every mounted brain, and the write path ends with a push.
An answer built on a stale checkout is built on knowledge the brain has
already corrected; the first skill makes this its first instruction.

brainpick reflects the read path in `brain_overview` by listing skills
first — `type: skill` or `playbook`, the *type*, never the folder, because
brainpick does not read folder names
([Structure agnosticism](structure-agnosticism.md)) — and boosts a matching
skill ×1.2 in `brain_search` ([Search modes](search-modes.md)). The order is
normative for the template and the first skill; the boost is the engine's
one type-keyed ranking signal ([Skills](skills.md)).

## The nudge: improve as you go

A read that finds nothing in `skills/` but something in `journals/` is not a
failure — it is a **distillation opportunity**. The template's first skill
tells the agent so: when you reach a less distilled layer, consider whether
what you found should be promoted, and promote it. The brain is the best
knowledge available at the moment, never the truth; the data flow
architecture is how it gets better every time it is used. The mechanics of
the write — a doc, a pointer back, a bumped timestamp, a passing contract —
are [Guarded writes](guarded-writes.md).

## Skills form a tree

Skills declare what they assume in `depends_on` frontmatter; `skilltree.md`
is generated from those edges and never edited — edit the skills. The tree
is the brain's procedural map: the roots are skills that assume nothing,
the leaves are the most specific procedures. `depends_on` is an edge in the
link graph, an unresolved one a ghost, a cycle a compile warning; the
deterministic parts of a skill demote into `tools` the agent runs itself
([Skills](skills.md)). See [The brain template](brain-template.md) for the
contract that enforces it.
