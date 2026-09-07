---
type: article
about: concept
title: Structure agnosticism
description: "Principle 14 — brainpick is a thin view, not a format owner: it reads the bundle root, frontmatter and OKF's reserved names, never folder layout, so a wiki, a brain or anything in between compiles the same way and a brain born on any template version keeps working with every later brainpick."
tags: [brain, spec, design]
timestamp: 2026-09-07T16:00:00Z
---

# Structure agnosticism

Brainpick shows what is correctly formatted; it does not decide what the
format is. That is principle 14 in the
[README](https://github.com/benquemax/brainpick/blob/main/README.md): **a
thin view, not a format owner.** This page says what that means in
practice and why it is worth the discipline.

## The contract with a bundle

Everything brainpick reads from a bundle fits in four lines:

- **A root** — [bundle.root](reference/config/bundle-root.md), scanned
  recursively minus the always-excluded directories and
  [bundle.exclude](reference/config/bundle-exclude.md).
- **Frontmatter** — `type` (the one MUST), `title`, `description`, `tags`,
  `timestamp`, `about`; and for a [brain](brain.md), `depends_on` and
  `export`. Unknown keys are carried and ignored.
- **Reserved names** — `index.md` and `log.md` are recognised by name only
  ([Wiki conventions](wiki-conventions.md)).
- **Links** — relative markdown links between files.

Folder names are never in that list. `_brain/` with five memory types,
`docs/` with a `reference/` tree, or a flat pile of markdown with `type:`
all compile to the same artifacts ([The tiers](the-tiers.md)). The
[Compile pipeline](compile-pipeline.md) does not have a code path that
asks what a folder is called.

## What it buys

**Freedom for the user.** A wiki, a brain, or something in between is the
user's call — and the template's, and the henxels contract's
([The brain template](brain-template.md)). Someone who wants their journals
as one file per week, or no `vision/` at all, changes their contract and
brainpick follows without a flag.

**Backwards compatibility for free.** A brain scaffolded under today's
template keeps working with every later brainpick, and a brain scaffolded
under a later template works with today's, as long as the frontmatter
contract holds. When the template changed its journal from dated files to
monthly files with dated sections, brainpick did not notice — it only ever
saw markdown with `##` headings. That is the whole migration story for the
layout: there is none.

**Safety for the developers.** Because the engine never keys on layout, a
release cannot break an earlier brain by renaming a folder or moving a
reserved file. The only way to break an old brain is to change the
frontmatter keys — which is why those are governed by a rule of their own.

## The rule for keys

The frontmatter keys brainpick reads are **additive-only**: a key is never
renamed, never removed, and never made newly required. A new capability
arrives as a new optional key that older brains simply lack. This is
stated for the brain keys in
[Spec: brain format](reference/spec/brain-format.md) and holds for the OKF
keys by OKF's own compatibility promise.

## What it forbids

Any brainpick feature whose correctness depends on a folder name. Concrete
cases that were considered and rejected:

- **A `brainpick journal roll` command.** Moving last month's journal into
  `journals/archive/` is knowledge about *this template's* layout. The
  moment brainpick knows it, brainpick owns the layout. The roll is the
  agent's act (the first skill teaches it) and the contract's check
  (`max_files: 1` on the folder) — see
  [Data flow architecture](data-flow-architecture.md).
- **`brain_overview` listing `skills/` first.** Reframed as listing
  `type: playbook` docs first — the same intent, keyed on frontmatter.
- **Excluding `raw/` by name.** It is excluded because the template's
  `brainpick.toml` says `exclude = ["raw/*"]`, a config the user owns, not
  because the engine recognises the folder.

The line is easy to draw: if a feature would stop working when a user
renames a folder in their own contract, it does not belong in brainpick.
It belongs in the template, in the skill, or in henxels
([Henxels contract reference](reference-henxels.md)).

## Where the layout does live

The folder table in [Spec: brain format](reference/spec/brain-format.md)
is normative for the template and informative for engines. Cross-brain
addresses ([Brain subsidiarity](brain-subsidiarity.md)) carry paths, so a
layout change is a link change between brains — the one real cost, borne
by content, never by the engine.
