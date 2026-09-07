---
type: reference
about: concept
title: "Spec: brain format"
description: "The normative contract for a brain — the fixed _brain/ root, the five memory-type folders, the engine-consumed frontmatter keys and their additive-only policy, inline grounding, the data flow's folder order, the [brain] config section, the brain:// link syntax and the format version with its migration rule."
tags: [spec, brain-format]
timestamp: 2026-09-07T11:30:00Z
---

# Spec: brain format

`spec/85-brain-format.md` fixes what both engines and the henxels template
must agree on for [The brain](../../brain.md): the parts that end up in
committed content and would hurt to change later.

- **Bundle root.** `_brain/` at the repository root — fixed, because other
  brains' links and registries name it. `_temp/` is always excluded;
  project management (`_todo.md`) stays beside the brain.
- **Folders are memory types.** `knowledge/` (semantic), `skills/`
  (procedural, with generated `skilltree.md`), `journal/` (episodic,
  `YYYY-MM-DD-slug.md` plus `log.md`), `vision/` (a book with an `index.md`
  contents page) and `plans/` (decided work). The five are sufficient: a
  new memory type is a `type` value or a sub-folder, never a sixth sibling.
  Engines tolerate any of them being absent.
- **Frontmatter.** OKF's fields are OKF's. The format adds only keys the
  engine consumes: `depends_on` (skill edges) and `export: agent-skill`
  (write the skill out as a harness `SKILL.md`). Additive-only: never
  renamed or removed, optional for at least one version after appearing,
  unknown keys ignored.
- **Grounding.** Inline, a plain link at the claim; the target's kind
  (journal entry, external URL, `brain://`, or an admitted assumption in
  words) is the provenance. Journal entries are primary sources and exempt.
- **Data flow.** Write path `journal → knowledge → skills`, pointers upward
  instead of copies; read path the mirror. Folder order is normative;
  `brain_overview` lists `skills/` first, search ranking by folder is
  advisory.
- **`[brain]` config.** `format` (0 = not a brain), `origin` (git URL, a
  lookup key), `audience` (`personal` | `team` | `public`, unknown warns →
  personal), `readers`. All optional; `BRAINPICK_BRAIN_*` env overrides on
  the scalars.
- **`brain://` links.** `brain://<slug>-<id>/<path>` — slug for the reader,
  the trailing 21-char `[bundle] id` authoritative, path bundle-relative.
  Extracted with `kind: "brain"`, never counted as ghosts; resolution is
  federation's job and out of scope for format 1.
- **Versioning.** `[brain] format` is the stamp; a later format rewrites
  committed content only through `brainpick migrate --to N` (deterministic,
  dry-run diff) and keeps every earlier format servable.
- **Conformance class `brain`.** `[brain]` parsing with defaults, env and
  the audience warning in both engines; `brain://` extraction; a minimal
  fixture brain whose overview lists `skills/` first.

The reasoning is on [Data flow architecture](../../data-flow-architecture.md),
[Grounding](../../grounding.md) and [Brain subsidiarity](../../brain-subsidiarity.md);
the scaffold that produces a conforming brain is
[The brain template](../../brain-template.md). Each config key has a page
under the [Configuration reference](../../reference-config.md). Back to
[Spec reference](../../reference-spec.md).
