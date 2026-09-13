---
type: reference
about: concept
title: "Spec: brain format"
description: "The normative contract for a brain — the fixed _brain/ root, the six memory-type folders, the engine-consumed frontmatter keys and their additive-only policy, inline grounding, the data flow's folder order, the [brain] config section, the brain:// link syntax and the format version with its migration rule."
tags: [spec, brain-format]
timestamp: 2026-09-14T15:00:00Z
---

# Spec: brain format

`spec/85-brain-format.md` fixes what both engines and the henxels template
must agree on for [The brain](../../brain.md): the parts that end up in
committed content and would hurt to change later.

- **Bundle root.** `_brain/` at the repository root — fixed, because other
  brains' links and registries name it. `_temp/` is always excluded;
  scratch stays beside the brain, open work (`todo/`) is in it from
  format 2.
- **Folders are memory types — for the template.** `conventions/`
  (normative — one standing rule per page, `type: convention`, listed in
  `conventions/index.md`; from format 3 — [Conventions](../../conventions.md)),
  `knowledge/` (semantic), `skills/` (procedural, `type: skill`, with generated
  `skilltree.md`), `journals/` (episodic — one file per day `YYYY-MM-DD.md`,
  only today at the top, earlier days in `journals/archive/YYYY/MM/`;
  format 1 kept a month per file), `vision/` (a book with an `index.md`
  contents page), `plans/` (decided work) and `todo/` (`open.md` plus a
  per-day `archive/`, `type: todo` — [To-do lists](../../todo-lists.md)),
  plus `raw/` for undistilled source material
  that is excluded from the compiled brain via `[bundle] exclude`. The six
  memory types are sufficient: a new one is a `type` value or a sub-folder,
  never a further sibling. Engines never interpret folder names — they read
  the root, frontmatter and reserved names only, so the table is normative
  for the template and informative for engines
  ([Structure agnosticism](../../structure-agnosticism.md)); the day roll
  is the agent's act, not an engine command.
- **Frontmatter.** OKF's fields are OKF's. The format adds only keys the
  engine consumes, all on skills: `depends_on` (prerequisite edges, kind
  `depends_on`; unresolved → ghost), `tools` (plain file paths the skill
  drives — indexed, never executed) and `export: agent-skill` (`brainpick
  integrate` writes a pointer stub `SKILL.md` under the harness's skill
  directory — the brain stays canonical); plus the `type: todo` value that
  makes a doc's checklist lines to-do items and the `type: convention`
  value that makes a doc a standing rule. Additive-only: never
  renamed or removed, optional for at least one version after appearing,
  unknown keys ignored.
- **Skills.** A doc is a skill by `type` alone (`skill`, case-insensitive),
  never by folder; reserved files never are, and neither is a `playbook` —
  the same form for a human reader. Every
  compile writes `t1/skills.json`; a brain with a skill gets a generated
  `skilltree.md` beside its first skill; `brain_overview` lists skills
  first, `brain_read` returns their structure, keyword search boosts them
  ×1.2, and the brain report gains a *Skills* section. The engine never
  runs a tool ([Skills](../../skills.md)).
- **Conventions.** A doc is a convention by `type` alone (`convention`,
  case-insensitive), never by folder; a `decision` is the ADR that set the
  rule, not the rule. Every compile writes `t1/conventions.json`
  (`{path, title, description}` sorted by path, `{"conventions": []}` when
  none); `brain_overview` carries `conventions` before `skills`, never
  trimmed, and its hint opens with *N conventions apply — read them before
  acting*; the brain report gains a *Conventions (these apply to you)*
  section above *Skills*; the template pins `[half_life.folders]
  conventions = 0` ([Conventions](../../conventions.md)).
- **Grounding.** Inline, a plain link at the claim; the target's kind
  (journal entry, external URL, `brain://`, or an admitted assumption in
  words) is the provenance. Journal entries are primary sources and exempt.
- **Data flow.** Write path `journal → knowledge → skills`, pointers upward
  instead of copies; read path `conventions → skills → knowledge →
  journals` — the mirror, with the rules ahead of it. Folder order is
  normative for the template; `brain_overview` lists conventions, then
  skills, first by `type`, and the search boost is the one type-keyed
  ranking signal.
- **`[brain]` config.** `format` (0 = not a brain), `origin` (git URL, a
  lookup key), `audience` (`personal` | `team` | `public`, unknown warns →
  personal), `readers`. All optional; `BRAINPICK_BRAIN_*` env overrides on
  the scalars.
- **`brain://` links.** `brain://<slug>-<id>/<path>` — slug for the reader,
  the trailing 21-char `[bundle] id` authoritative, path bundle-relative.
  Extracted with `kind: "brain"`, never counted as ghosts; resolution is
  federation's job and out of scope for format 1.
- **Versioning.** `[brain] format` is the stamp — 3 is current (2 lacks
  the conventions type; 1 differs further in journal rhythm and
  `_todo.md`); a later format rewrites committed content only through
  [brainpick migrate](../cli/migrate.md) `--to N` (deterministic, writes by
  default, `--dry-run` for the action list and diff, cumulative one step at
  a time; the 1 → 2 step seeds the format's `[half_life]` defaults when
  absent, the 2 → 3 step retypes `conventions/*.md` from `decision` to
  `convention`, creates `conventions/index.md` when absent and adds
  `conventions = 0` to an existing `[half_life.folders]` — the two steps
  that write config; conformance class `migrate` holds the 1 → 2 rewrite of
  the fixture brain `kotiaivot-v1` and the 2 → 3 rewrite of `kotiaivot-v2`
  (case `migrate-kotiaivot-v2-to-3`), each to a golden tree) and keeps
  every earlier format servable; a brain whose stamp is behind is told by
  the [What's new notice](../../whats-new.md).
- **Conformance class `brain`.** `[brain]` parsing with defaults, env and
  the audience warning in both engines; `brain://` extraction; the fixture
  brain `kotiaivot` (format 3: two `skill` docs, one depending on the
  other, a tool, a `playbook` that must not be a skill, a `raw/`, and the
  convention `conventions/aamukahvi-ensin.md`) whose skills.json,
  conventions.json, skilltree.md, depends_on edge, boosted search
  order and report block are goldens, and whose manifest holds nothing from
  `raw/`; `[bundle] exclude` honoured by every scan in both engines.

The reasoning is on [Data flow architecture](../../data-flow-architecture.md),
[Grounding](../../grounding.md) and [Brain subsidiarity](../../brain-subsidiarity.md);
the scaffold that produces a conforming brain is
[The brain template](../../brain-template.md). Each config key has a page
under the [Configuration reference](../../reference-config.md). Back to
[Spec reference](../../reference-spec.md).
