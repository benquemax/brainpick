---
type: reference
about: thing
title: "brainpick skill"
description: "List a brain's skills with their prerequisites and tools, or scaffold a compliant empty skill — type: skill, real timestamp, linked prerequisites, the evaluate-and-improve loop in its body — and compile so the tree already knows it."
tags: [cli, skills]
timestamp: 2026-09-12T16:40:00Z
---

# brainpick skill

`brainpick skill list [--root DIR] [--json]` prints every skill the compiled
brain holds — path, title, description, `needs:` (resolved `depends_on`)
and `tools:` — from `t1/skills.json`; `--json` gives `{"skills": [...]}` in
the shape [brain_overview](../mcp/brain-overview.md) uses. Like the other
read mirrors it never compiles: an uncompiled brain gets the instruction on
stderr (or a JSON error with `--json`) and exit code 0.

`brainpick skill new NAME [--root DIR] [--title T] [--description D]
[--depends-on PATH]... [--tool PATH]...` writes `NAME` kebab-cased as a
`.md` beside the existing skills (the directory of the first one by path;
`skills/` when there are none yet — the folder
[The brain template](../../brain-template.md) scaffolds), refuses to overwrite, and then runs a
compile so `skilltree.md`, the overview and the brain report already list
it. The page it writes is compliant with the [brain](../../brain.md)
contract: `type: skill`, a quoted title and description, a real UTC
`timestamp`, `depends_on` and `tools` as given, and a body with `Trigger`,
`Steps`, `Tools`, `Gotchas`, `When not to use this`, `Evaluation log` and
`Related` — each prerequisite linked by title in the body so the new page
is not an orphan. A prerequisite that is not a doc, or a tool that does not
exist yet, is a warning on stderr, never an error: the page is the place to
finish the thought. The default description is a placeholder that starts
with "Use when …" — replace it; it is what search and the overview show.

Brainpick ships no skills of its own and never runs a tool — see
[Skills](../../skills.md) for why. Back to [CLI reference](../../reference-cli.md).
