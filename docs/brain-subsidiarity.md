---
type: article
about: concept
title: "Brain subsidiarity"
description: "When several brains hold conflicting information the one closest to the implementation wins; how brains address each other by identity rather than location, why the human-readable slug rides next to the id in every cross-brain link, and the procedure for deciding whether shared knowledge stays duplicated or becomes a pointer."
tags: [brain-format]
timestamp: 2026-09-07T11:30:00Z
---

# Brain subsidiarity

An agent rarely has one [brain](brain.md). It has the project's brain, maybe
a team's, and a personal one — and [Federation](federation.md) lets one
search reach all of them. The moment there are two, they can disagree.
**Subsidiarity** is the rule for that: *the brain closest to the
implementation wins.*

## Closest wins

If the project brain says the vector store is LanceDB and the personal
brain says sqlite-vec, the project brain is right — it is the one the code
was written against. Proximity to the implementation is the tiebreaker
because it is the brain most likely to have been updated by the change
itself; distant brains learn about things second-hand.

The same ordering is why the read path of the
[Data flow architecture](data-flow-architecture.md) starts with the
*closest* brain before it starts with `skills/`: closeness is the first
retrieval axis, distillation is the second.

## The procedure, not a check

Subsidiarity is something an agent does, not something an engine enforces.
When a conflict surfaces:

1. **Update both.** The closer brain gets the correction (if it was wrong);
   the farther brain gets the correction too, because the next reader may
   not have the closer brain.
2. **Decide: duplicate or pointer?** Ask who reads the farther brain. If
   its readers also have the closer brain, replace the information with a
   `brain://` pointer and stop maintaining two copies. If they may not — a
   personal brain that cites a private project, a public brain that cites a
   team one — keep the duplicate, grounded with a `brain://` link to where
   it came from, and accept that it may lag.
3. **Record the episode.** A journal entry in the brain that changed, so
   the correction is traceable ([Grounding](grounding.md)).

This lives in the template's first skill, `using-the-brain.md`, because it
is procedural memory: the brain instructs its own reader.

## Addressing a brain: identity, not location

Brains are addressed by **what they are**, never by where they sit on a
disk. Physical paths differ per person and per clone convention; even git
URLs move when a forge is renamed. The durable key is the
[bundle.id](reference/config/bundle-id.md) that `brainpick init` mints — a
random 21-character address that never changes — and the git URL is a
*lookup key* the registry uses to find a clone
([brain.origin](reference/config/brain-origin.md)).

A cross-brain link carries both, Notion-style — a human-readable slug for
the reader and the id for the resolver:

```
brain://personal-brain-k7f3m2x9q1w8e5r4t7y6u/knowledge/lancedb.md
       └── slug ─────┘ └──────── id ─────────┘ └──── path ──────┘
```

The slug is ignored by resolvers, so a renamed brain never breaks a link;
the id is authoritative; the path is bundle-relative, exactly like a rooted
link inside the brain. The syntax is fixed in
[Spec: brain format](reference/spec/brain-format.md) so that no two brains
ever invent different ones; *resolution* — turning the id into a served
brain through the federation registry — is a later brainpick feature, and
the format reserves the shape now so links written today keep working then.

## Audience decides what to write

Subsidiarity also answers "should this go in the project brain or mine?"
by the same proximity test, and [brain.audience](reference/config/brain-audience.md)
answers the follow-up: a `personal` brain may assume everything its one
reader knows; a `team` brain names its readers and writes for the least
informed of them; a `public` brain assumes nothing. Where information
lands, and how much context it carries, both fall out of who will read it.
