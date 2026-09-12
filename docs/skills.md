---
type: article
about: concept
title: "Skills"
description: "Procedural memory in a brain — a skill is a distilled, tested procedure an agent follows, with its repetitive parts demoted to tools it drives; recognised by type, linked by depends_on, listed first, boosted in search, never executed by brainpick — and why brainpick ships the framework but no skills of its own."
tags: [brain-format, agents, skills]
timestamp: 2026-09-12T18:10:00Z
---

# Skills

A skill is the most distilled thing a [brain](brain.md) holds: a procedure
an agent has done before, written down so the next time costs a read
instead of a rediscovery. The [Data flow architecture](data-flow-architecture.md)
puts it at the end of the write path — episodes become knowledge become
skills — and at the *start* of the read path: before improvising a
workflow, an agent checks whether the brain already knows how. This page is
what brainpick does to make that check cheap, and what it deliberately
leaves to the agent.

## What a skill is, to the engine

A document is a skill when its `type` is `skill`, compared
case-insensitively, wherever the file lives. The `skills/` folder is the
[brain template](brain-template.md)'s convention; the engine never tests a
folder name, which is [Structure agnosticism](structure-agnosticism.md)
applied to the one memory type that most tempts a special case. A reserved
file (`index.md`, `log.md`, the generated `skilltree.md`) is never a skill
whatever its frontmatter says.

A `playbook` is not a skill. Same form — step-by-step instructions — but a
different audience: a playbook is what a *human* follows, a skill is what
an *agent* follows, and the ontology keeps them apart on purpose
([The two-axis ontology](ontology.md)). The first version of this feature
treated `playbook` as an alias, and this wiki's own compile showed why that
is wrong: *Wiki conventions*, a how-to for whoever writes here, appeared
under "read before improvising" in the brain report. An agent handed a
procedure written for someone else has been handed noise. Brains born
before the type existed typed their procedures `Playbook`; retyping the
agent-facing ones `skill` is the one-line migration.

Two frontmatter keys carry the skill's structure
([Spec: brain format](reference/spec/brain-format.md)):

- `depends_on: [skills/veden-keitto.md]` — the skills this one assumes.
  Each entry resolves like a link target (rooted, then relative); a resolved
  one becomes an edge of kind `depends_on` in T1's link graph ([The tiers](the-tiers.md))
  with the target's title as label, an unresolved one is a ghost — the same
  write-next queue a dangling link lands in, so an unwritten prerequisite
  is visible. It is a prerequisite relation, *read these first*, not a
  version constraint: skills in one brain are versioned together by Git.
- `tools: [tools/keita]` — the deterministic parts, demoted to scripts. A
  tool is a plain file the bundle holds; it never enters the graph. The
  engine records where it is and whether it exists; nothing more.

On any other document both keys are ignored. Every full compile writes
`t1/skills.json` — the skills sorted by path with their resolved
prerequisites and tools ([Spec: T1 artifacts](reference/spec/t1-artifacts.md)) —
and it is part of the freshness gate like `graph.json`.

## What the engine does with skills

- **`skilltree.md`** — in a bundle that declares itself a brain
  (`[brain] format = 1`, [brain.format](reference/config/brain-format.md))
  and holds at least one skill, compile generates the tree into the
  directory of the first skill: every skill, its `needs` lines, its tools.
  Written before the artifact scan like the index, so the manifest records
  it and `--check-fresh` sees a stale tree. A wiki without `[brain]` never
  gets one; a brain whose last skill goes keeps whatever is on disk. A cycle
  in `depends_on` is a compile warning naming the skills — the tree still
  renders each once.
- **Listed first.** [brain_overview](reference/mcp/brain-overview.md) carries
  a `skills` section apart from the folder tree — path, title, description,
  prerequisites, tools — trimmed only after the tree is empty. The
  brain report in `AGENTS.md` ([Agent integrations](agent-integrations.md)) gets a *Skills (read before
  improvising)* section, present only when there is a skill: a wiki's
  report is unchanged.
- **Read with structure.** [brain_read](reference/mcp/brain-read.md) on a
  skill adds `skill: {depends_on, dependents, tools}` with each tool's
  `exists`, and a hint that says *read the prerequisites first* and *run
  the tools yourself*.
- **Boosted in search.** A skill's BM25 score is multiplied by 1.2
  ([Spec: REST API](reference/spec/rest-api.md)). It only reorders documents
  the query already matched — a skill never surfaces on its own — and it is
  the one `type`-keyed ranking signal both engines implement, deterministic
  and proven by a conformance case that asserts the *order*. The fixture
  brain `kotiaivot` is why it exists: its knowledge page says "morning
  coffee" twice and outranks the coffee-brewing skill under raw BM25.
- **Scaffolded, not shipped.** [brainpick skill](reference/cli/skill.md)
  lists a brain's skills and writes a compliant empty one — `type: skill`,
  a real timestamp, `depends_on` linked in the body so it is not an orphan,
  and a template body that embeds the loop: trigger, steps, tools, gotchas,
  when not to use this, evaluation log. Then it compiles, so the tree and
  the overview already know the new page.

## What the engine refuses to do

**brainpick never executes a tool.** Not from the CLI, not over MCP. The
MCP server runs outside the agent's sandbox — a `brain_run` tool would be a
way to run anything with any parameters past every approval policy the
harness enforces. Execution belongs to the agent's own shell, under the
agent's own permissions; brainpick's job ends at *here is the tool, it
exists, this skill drives it*. This is the sandbox question answered by
drawing the line where the trust boundary already is.

**brainpick ships no skills.** Not a meta-skill, not a starter set. A skill
is something an agent distils from its own repetition; a skill written in
advance by someone who never ran the loop is a guess with a `type` field.
The framework is the product: skills live in the brain, compile with it,
and move with it when the harness changes — that is the point of keeping
them there rather than in a harness-specific folder. Project-specific
skills live in the project (its implants, ideally); a personal brain holds
the ones that follow the person — [Brain subsidiarity](brain-subsidiarity.md)
decides which brain answers, and behind a [Federation](federation.md) every
skill path in an overview or read is qualified `alias:path`, so a skill in
a neighbouring brain is still one `brain_read` away. Whatever brain it
lives in, a skill says where its steps came from like any other page
([Grounding](grounding.md)): the journal entries it was distilled from are
its provenance. This is the [hypothesis](the-hypothesis.md)
in practice: the intelligence is in the evolving knowledge and skills, and
the tool's job is to make evolving them frictionless.

## The loop the format supports

Notice repetition → distil it into a skill → extract the deterministic
parts into `tools` → after every use, evaluate: did the steps hold, what
was manual that should be a tool → improve. The cost hierarchy behind it:
a script is cheaper than a model running a workflow, which is cheaper than a
human. Every engine surface above serves one step of the loop — the
overview and the boost make *notice there is a skill* free, `brain_read`'s
structure makes *follow it* one call, [brain_write](reference/mcp/brain-write.md)
in `replace` mode bumps `timestamp` so *improve it* is one call too, and
`skilltree.md` shows where a new skill sits among the old.

Still to come: `export: agent-skill`, which mirrors a skill out as a
harness-loaded `SKILL.md` through [Agent integrations](agent-integrations.md),
and a visual style for `depends_on` edges in the
[holographic brain](holographic-brain.md).
