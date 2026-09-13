---
type: article
about: concept
title: "Conventions"
description: "Normative memory as part of the brain — a type: convention doc is a standing rule the engine lists before anything else: compiled into conventions.json, first in brain_overview and in the AGENTS.md report, pinned by half-life 0; brain format 3 makes the template's conventions/ folder a type the engine recognises, and migrate --to 3 corrects the older stamp."
tags: [brain-format, agents]
timestamp: 2026-09-14T15:00:00Z
---

# Conventions

Every brain accumulates answers to "how do we do this here": commit
messages are imperative, a page names its sources, the kettle is descaled
on the first of the month. Such a rule is not a fact about the world
(`knowledge/`), not a procedure to execute (a [skill](skills.md)), not the
record of the moment it was chosen (`type: decision`, an ADR, which never
changes once written) — it is the *standing result* of that choice, edited
as practice evolves and ideally linking back to the decision that set it.
The [brain template](brain-template.md) has kept such pages in
`conventions/` since henxels 0.16, but stamped them `type: decision`, and
the engine did not know the folder existed: an agent read the rules only
if it happened to browse there. Brain format 3 makes conventions the sixth
memory type — `type: convention`, one rule per page, listed in
`conventions/index.md` — and the first thing an agent sees.

The engine does not know the folder ([Structure agnosticism](structure-agnosticism.md)).
It keys on `type: convention`, exactly as a skill is a skill and a
[to-do list](todo-lists.md) is a list by its `type`, wherever the file
lives. [Compile](compile-pipeline.md) writes every convention to
`t1/conventions.json` ([Spec: T1 artifacts](reference/spec/t1-artifacts.md))
as `{path, title, description}` sorted by path, part of the freshness gate
like `skills.json`, `{"conventions": []}` in a wiki without rules.

Three surfaces read it, and each puts conventions first. [brain_overview](reference/mcp/brain-overview.md)
always carries a `conventions` list ahead of `skills` in the object, never
budget-trimmed (the folder tree empties first), and when there are any its
hint opens with *N conventions apply — read them before acting* — an agent
that reads only the first line of its first call learns that rules exist.
The AGENTS.md report block ([Agent integrations](agent-integrations.md))
carries a `Conventions (these apply to you):` section above its `Skills`
section, present only when the bundle holds at least one, so the rules are
on the page a harness loads before it calls any tool. And `brainpick
overview` prints the same list under the same heading. A rule constrains
what every other read is for, so the read path ([Brain](brain.md)) now runs
`conventions/`, then `skills/`, then `knowledge/`, then `journals/` — and
`brainpick init` says so.

Rules should not fade. [Half-life](half-life.md) resolves per document,
most specific wins, and the template's `[half_life.folders]` pins
`conventions = 0`; a convention filed elsewhere pins itself with
`half_life: 0` in its frontmatter. Search treats it as any prose page
otherwise: the kotiaivot fixture's *Aamukahvi ensin* ranks among the coffee
pages by its words, unboosted — the overview, not the ranking, is where a
rule leads.

What the engine never does is write a rule. Changing one is
[brain_write](reference/mcp/brain-write.md) or the agent's editor, and a
change is a decision worth a journal entry. Two cautions from the
template's own practice: an *enforced* rule — a henxels contract, the
[brain ritual](brain-ritual.md) — stays where it is enforced, and a
convention page links to it rather than restating it; and a convention is
not a plan (`plans/`, a specific piece of work) nor a skill (a procedure to
follow step by step) — it is the standing answer, applied broadly.

[brainpick migrate](reference/cli/migrate.md) `--to 3` carries an existing
brain across mechanically ([Spec: brain format](reference/spec/brain-format.md),
*Versioning and migration*): every `conventions/*.md` the template stamped
`type: decision` is retyped to `type: convention` in place — the line only,
and only that stamp; a page the author typed otherwise is left alone —
`conventions/index.md` is created when absent, the stamp bumps, and a
`[half_life.folders]` table without a `conventions` key gains
`conventions = 0`. The fixture brain `kotiaivot-v2` migrated by either
engine is the golden tree, byte for byte. [Upgrading](upgrading.md) walks
the whole sitting.
