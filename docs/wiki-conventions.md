---
type: Playbook
title: Wiki conventions
description: How concepts in this wiki are written, typed and linked — and why this wiki doubles as brainpick's dogfood corpus.
timestamp: 2026-07-02T00:00:00Z
---

# Wiki conventions

One concept, one kebab-case markdown file, with OKF frontmatter: `type` is
the one MUST; `title`, `description` and `timestamp` keep a page findable and
compilable. The `description` matters more here than in most wikis — it is
the one-sentence summary that the [compile pipeline](compile-pipeline.md)
will lift into the generated index and that agents see first in every search
result.

Types in this bundle: **Concept** (an idea or mechanism), **Reference** (an
enumerable surface — tools, matrices, ladders), **Decision** (an ADR-style
record), **Playbook** (how to do something, like this page).

Link relatively, and make the link text the target's title — the text
survives markup stripping as a clean entity mention when the
[knowledge graph tier](knowledge-graph-tier.md) extracts over this corpus.
Every page links out at least once: a concept is a node in
[the tiers](the-tiers.md)' T1 graph, not an island. New top-level concepts
are listed in the index, and notable changes get a dated entry in the update
log, newest first.

This wiki is also test mass: it is the first bundle brainpick compiles,
serves and visualizes, so write generously — every feature lands with its
concept page, and the corpus is meant to grow until the interface sweats.
