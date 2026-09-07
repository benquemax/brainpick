---
type: decision
about: concept
title: "ADR: the brain format is a spec, the brain template lives in henxels"
description: "Why brainpick specifies what a brain is but does not scaffold one — the starter template ships as a henxels use-case template, brainpick stays a renderer of well-formed data, and the two meet through the [brain] config section and a wiki the template links back to."
tags: [brain-format, henxels, agents]
timestamp: 2026-09-07T11:30:00Z
---

# ADR: the brain format is a spec, the brain template lives in henxels

**Context.** Tom wants every project he touches to carry a brain with the
same conventions from day one, so none is migrated to a better standard
later. That needs a starter template. brainpick could scaffold it, but
brainpick's identity is a tool that renders correctly formatted data —
[The two-axis ontology](../../ontology.md) and OKF are inputs it honours,
not layouts it imposes. henxels, meanwhile, is already a hard requirement
(it referees [Guarded writes](../../guarded-writes.md) and the commit gate)
and already ships use-case templates whose contracts carry a `why:` per
rule and sync into `AGENTS.md`.

**Decision.** Split the brain into a *format* and a *template*. The format —
`_brain/`, the five memory-type folders, the engine-read frontmatter keys,
`[brain]` config, `brain://` links, the version stamp — is a brainpick spec
([Spec: brain format](../spec/brain-format.md)) with conformance in both
engines. The template — the scaffold and the henxels contract that enforces
the format — is `henxels init --template brainpick-brain`, living in the
henxels repository. brainpick's own wiki holds the canonical reasoning
([The brain](../../brain.md), [Data flow architecture](../../data-flow-architecture.md),
[Grounding](../../grounding.md), [Brain subsidiarity](../../brain-subsidiarity.md),
[The brain template](../../brain-template.md)) and the template links to it.

**Alternatives considered.** A `brainpick init --template brain` — rejected:
it puts layout opinion into the renderer and duplicates henxels' contract
machinery. A brain format with no template, conventions by documentation
only — rejected: nobody reads documentation, and a contract that is not
enforced is not a convention. A generic `_wiki/` template extended with
brain rules — rejected: the name carries the opinion, and once other brains
link into `_brain/` the name is part of the address.

**Consequences.** brainpick gains a small, spec-first surface: the
`[brain]` section ([brain.format](../config/brain-format.md),
[brain.origin](../config/brain-origin.md),
[brain.audience](../config/brain-audience.md),
[brain.readers](../config/brain-readers.md)), later `_brain/` detection in
[brainpick init](../cli/init.md), an overview that lists `skills/` first, and
the Agent Skill export. henxels gains a template and a backlink — a
distribution channel for brainpick among henxels users. The cost is a design
that spans two repositories, mitigated by keeping the *semantics* here and
only the *scaffold* there. Back to
[Architecture decision records](../../reference-adr.md).
