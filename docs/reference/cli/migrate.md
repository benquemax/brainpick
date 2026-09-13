---
type: reference
about: thing
title: "brainpick migrate"
description: "Rewrite a brain from its stamped format up to a newer one — deterministic, mechanical, writes by default; --dry-run prints the same action list plus a diff and touches nothing."
tags: [cli, brain-format]
timestamp: 2026-09-14T15:00:00Z
---

# brainpick migrate

`brainpick migrate --to N [--root DIR] [--dry-run]` rewrites the brain at
`--root` (a repo root or the bundle itself, through `[bundle] root`) from
its stamped `[brain] format` up to format `N` (3 is the latest), one step
at a time — `--to 3` from format 1 runs 1 → 2 then 2 → 3. It is the
one command that touches committed bytes ([Spec: brain format](../spec/brain-format.md)):
mechanical — it moves and splits files, rewrites links and the stamp, never
prose — and deterministic, so the same brain migrated by either engine
yields the same tree byte for byte (conformance class `migrate`).

It **writes by default** and prints every action it took, one per line —
`split journals/2026-07.md → 2 day files`, `move journals/2026-07.md#2026-07-01
→ journals/archive/2026/07/2026-07-01.md`, `rewrite links in knowledge/kahvi.md
(3)`, `move _todo.md → todo/open.md`, `stamp brainpick.toml: format 1 → 2` —
then says `review with git diff, then run brainpick compile`. Git is the
undo; an agent runs one command, reviews, commits. `--dry-run` prints the
same action list plus a unified diff and writes nothing. It refuses a
downgrade, a bundle that is not a brain, and a format this engine does not
know; at the target already it says so and does nothing. It never compiles.

The 1 → 2 step turns month files into day files (today's at the top of
`journals/`, every other day under `journals/archive/YYYY/MM/`), rewrites
every link to a month or a day section so it lands on the day file, moves
the gitignored `_todo.md` into the brain as `todo/open.md`
([To-do lists](../../todo-lists.md)), bumps the stamp and — the one step
that writes config — appends the format's `[half_life]` defaults
([Half-life](../../half-life.md): 365 days, journals 180, to-dos 90,
skills never) when `brainpick.toml` has none, so a migrated brain matches a
freshly scaffolded one. "Today" is the
local date, or `BRAINPICK_TODAY=YYYY-MM-DD`.

The 2 → 3 step makes the template's rules a memory type the engine knows
([Conventions](../../conventions.md)), in four actions: (1) every top-level
`conventions/*.md` (`index.md` and `log.md` excepted) whose frontmatter
`type` is `decision` gets that one line rewritten to `type: convention` —
only that stamp; a page the author typed otherwise is untouched
(`retype conventions/x.md: decision → convention`); (2) `conventions/index.md`
is created when absent, a fixed seed with a *Conventions* heading and
*(none yet)* (`create conventions/index.md`); (3) the stamp
(`stamp brainpick.toml: format 2 → 3`); (4) when `brainpick.toml` has a
`[half_life.folders]` table without a `conventions` key, the line
`conventions = 0         # rules never fade` is appended after its last key
(`add conventions = 0 to [half_life.folders]`) — the table is never
invented. The fixture brain `kotiaivot-v2` migrated to its golden tree is
the conformance case (`migrate-kotiaivot-v2-to-3`). The details of every rule are
on [The brain template](../../brain-template.md); a brain whose stamp is
behind hears about this command from the
[What's new notice](../../whats-new.md) at every compile until it runs it.
Back to [CLI reference](../../reference-cli.md).
