# The brain format — an opinionated OKF bundle for agents

A **wiki** is a collection of information. A **brain** is a wiki that is
meant to be the memory of an agent: an OKF bundle with a recommended folder
layout, a declared **data flow architecture** (how raw episodes become
evergreen knowledge become actionable skills), inline grounding for every
claim, and an identity other brains can address. brainpick serves any
well-formed OKF bundle; a brain is the shape brainpick *recommends*, and
the shape the henxels `brainpick-brain` starter template produces.

**The layout belongs to the template, never to the engine.** Engines read
the bundle root (spec/80), frontmatter and OKF's reserved file names; they
MUST NOT interpret folder names. Everything an engine does for a brain is
keyed on frontmatter (`type`, `depends_on`, `export`) and on `[brain]`
config, so a brain scaffolded under any version of the template — or laid
out by hand — keeps working with every later engine as long as the
frontmatter contract holds (principle 14: a thin view, not a format owner).
The folder table below is therefore *informative* for engines and
*normative* for the template.

This section fixes what both engines and the template must agree on: the
folder layout, the frontmatter keys the engine consumes, the `[brain]`
config section, the cross-brain link syntax and the format version. The
*why* — memory types, promotion, subsidiarity — is in the wiki
(`docs/brain.md` and its neighbours); this document is the contract.

## Bundle root

The bundle root is `_brain/` at the repository root. The name is
**fixed**: other brains link into it, registries list it and agent
instructions mention it. (`[bundle] root` keeps the engine indifferent to
the name; the cost of changing it is social, in every other brain's links.)

`_temp/` is always excluded (spec/80) and gitignored; nothing in it is
brain material. Scratch stays **beside** the brain, not in it. Open work is
not scratch: from format 2 the to-do list lives *in* the brain (`todo/`,
below), so "is anything about X still open?" is one `brain_search` away
instead of a grep. A format-1 brain kept `_todo.md` beside the brain.

## Folders are memory types

| Folder | Memory type | Holds | Reserved files |
|---|---|---|---|
| `knowledge/` | semantic | evergreen concept docs, one concept per page | — |
| `skills/` | procedural | distilled, actionable procedures (`type: skill`) and, beside them, the `tools/` they drive | `skilltree.md` (generated) |
| `journals/` | episodic | one file per **day**, `YYYY-MM-DD.md`, entries newest first under any heading (`## HH:MM` or a title); only today at the top level, every earlier day in `journals/archive/YYYY/MM/` | `index.md` |
| `todo/` | open work | `open.md` — the current to-do list as checklist lines (`- [ ]` open, `- [x]` done) under `type: todo`; the moment an item is done it moves to `todo/archive/YYYY-MM-DD.md`, the day it was closed, so `open.md` stays small and "done" is an episode with a date | `index.md` |
| `vision/` | direction | the northstar as a book; `index.md` is its table of contents | `index.md` |
| `plans/` | decided work | one plan per page; undecided ideas do not belong here | `index.md` |
| `raw/` | *(not a memory type)* | undistilled source material — transcripts, exports, clippings — that knowledge grounds on; no frontmatter, kebab-case, listed in its index, **excluded from the compiled brain** via `[bundle] exclude = ["raw/*"]` | `index.md` |

Every folder MAY hold sub-folders. The five memory types are
**sufficient**: a memory type that does not fit is a `type` value or a
sub-folder, never a seventh sibling (`todo/` is not a memory type — it is
the brain's own work queue, kept in the brain so it is searchable). Engines MUST tolerate brains that omit
any folder (an empty memory type is simply empty) and MUST NOT depend on
any being present.

Journals are logs, not concept docs: no frontmatter, the file name is
the ISO date. A day per file caps the length forever and gives the
half-life (spec/50) a file-level unit; the **day roll** — moving
yesterday's file into `archive/YYYY/MM/` before the first entry of a new
day — is the agent's act (taught by the first skill) and the contract's
check (the template allows one file at the top of `journals/`), never an
engine command: the engine does not know the layout. A grounding link to
a day is a link to a file, no anchor:
`../journals/archive/2026/09/2026-09-07.md`.

Format 1 kept one file per month (`YYYY-MM.md`, a `## YYYY-MM-DD` section
per day, the previous month rolled into a flat `journals/archive/`). Both
layouts are plain OKF logs; engines serve either without noticing.
`brainpick migrate --to 2` (see *Versioning and migration*) splits each
month file by its day sections into `archive/YYYY/MM/YYYY-MM-DD.md`
(today's stays at the top), rewrites `journals/YYYY-MM.md#YYYY-MM-DD` links
to the day files, moves `_todo.md` to `todo/open.md` under `type: todo`,
and bumps the stamp.

Raw material stays greppable (T0) and is what claims ground on, but it
never enters T1–T3: it is noisy by nature and would drown the distilled
layers. Agents keep it orderly — named for what it is, indexed, pruned once
distilled.

The root `index.md` is generated (`[index] mode = "section"`, spec/20) and
never hand-edited; `log.md` files are date-sectioned, newest first (OKF).

## Frontmatter

OKF fields (`type`, `title`, `description`, `timestamp`) are OKF's, not
brainpick's, and are used as spec/20 describes. The brain format adds keys
the **engine** consumes; keys a human reads (provenance, sources) are prose,
not frontmatter — see *Grounding* below.

| Key | On | Type | Meaning |
|---|---|---|---|
| `depends_on` | skills | list of doc paths (bundle-relative, `.md`) | skills this skill assumes; `depends_on` edges in T1 (spec/20) and the edges of the generated `skilltree.md` |
| `tools` | skills | list of file paths (bundle-relative) | the deterministic scripts this skill drives; indexed and pointed at, never executed by an engine |
| `export` | skills | `agent-skill` (string or list) | the doc is also exported as a harness-loaded Agent Skill (`SKILL.md`) by `brainpick integrate` — see *Exported skills* |
| `type: todo` | to-do lists | OKF `type` value | the doc's checklist lines are to-do items the engine indexes — see *To-do lists* |

### Skills

A **skill** is procedural memory: a distilled, tested procedure an agent
follows, with the repetitive parts demoted to scripts it drives. A doc is
a skill by its `type` — `skill`, matched case-insensitively — wherever it
lives (spec/20); the `skills/` folder is the template's convention, never
the engine's test. A `playbook` is the same form for a different audience —
step-by-step instructions a *human* follows — and is deliberately not a
skill: listing it under "read before improvising" would hand an agent a
procedure written for someone else. A brain born before format 1.1 typed
its procedures `Playbook`; retyping them `skill` is the one-line migration,
and the template writes `skill` from 1.1 on.

Skills exist because of a cost hierarchy: a script is cheaper than a model
running a workflow, which is cheaper than a human. The loop a skill
supports — notice repetition, distil it into a skill, extract the
deterministic parts into `tools`, evaluate after every use and improve —
is the agent's; the engine makes it cheap: skills are listed first in
`brain_overview`, boosted in `brain_search` (spec/50), and `brain_read` on
a skill returns its prerequisites, dependents and tools (spec/70).
`brain_write` in `replace` mode bumps `timestamp`, so improving a skill
costs exactly one call.

`depends_on` is a prerequisite relation — read/load these first — not a
version constraint: skills in one brain are versioned together by Git, and
a cross-brain prerequisite is a `brain://` link. A tool is a plain file the
bundle holds; its interpreter, sandbox and permissions are the agent's
harness's concern. An engine MUST NOT run a tool on any caller's behalf,
including over MCP: the server is not the sandbox.

`skills/skilltree.md` is a generated reserved file: a top-down listing of
every skill with its prerequisites indented under it, plus the tools each
drives — the dependency DAG rendered for a reader. Engines MAY generate it;
the template's contract excludes it from frontmatter and orphan checks. A
cycle in `depends_on` is an authoring error the engine reports as a compile
warning; it never blocks T1.

### Exported skills

A skill the harness should load without being told — a procedure that
must fire on its trigger even in a session that never opened the brain —
declares `export: agent-skill`. The engine records it in `t1/skills.json`
as `"export": ["agent-skill"]` (`[]` otherwise; spec/20) and
`brainpick integrate <harness>` writes, beside the brainpick skill it
installs, one **pointer stub** per exported skill under the harness's
skill convention: `<skills dir>/<stem>/SKILL.md`, where `<stem>` is the
doc's file stem and `<skills dir>` is the directory the brainpick skill
lands in (`.claude/skills/` for `claude-code` and `dsh`, `.opencode/skills/`
for `opencode`). The stub is a pointer, not a copy — the brain stays
canonical and the stub never drifts from it:

```markdown
---
name: <stem>
description: <description, or the title when there is none>
---

# <title>

This skill lives in the brain at `<path>`. Read it there before acting —
`brain_read <path>` (MCP) or `brainpick read <path>` (CLI) — the brain
copy is canonical and carries its prerequisites and tools.

- Prerequisites: <depends_on, comma-separated, or "none">
- Tools: <tools, comma-separated, or "none">
```

Stubs are written in `path` order, overwrite their previous version, and
are the only files integrate writes for a skill; a stem equal to
`brainpick` is skipped with a warning (it would shadow the engine's own
skill). Removing `export` leaves a stale stub in place — the harness
directory belongs to the repo, not the engine — and integrate says so.
`agents-md` writes no stubs. Nothing about `export` changes search,
overview or `brain_read`.

### To-do lists

A doc whose `type`, trimmed and lowercased, is `todo` is a **to-do list**:
every checklist line in its body — `- [ ] text` (open) or `- [x] text`
(done), `*` or `+` bullets alike, at any indentation — is one item. The
template keeps `todo/open.md` (the live list) and `todo/archive/
YYYY-MM-DD.md` (what was closed that day, one file per day like a journal),
but the engine keys on the `type` alone, wherever the doc lives, exactly
as it does for skills. The engine compiles the items into `t1/todos.json`
(spec/20) and surfaces them where an agent looks: `brain_overview` counts
them (`todos: {"open", "done"}`), `brain_search` marks a hit that is a
to-do list with its open/done counts, and `brain_read` returns the doc as
it is. An item's date is the doc's `timestamp` (the archive file's day, by
the template's convention); an item may also end in `(done: YYYY-MM-DD)`,
which the engine records as its `done` date. The engine never edits a
list: ticking a box and moving a line to the archive is `brain_write` or
the agent's editor.

**Additive-only policy.** A brain-format key, once published, is never
renamed or removed; a newer format adds keys, and every key is optional for
at least one format version after it appears. An engine MUST ignore keys it
does not know (spec/20 already requires this for arbitrary frontmatter).

## Grounding

Every claim in `knowledge/` and `skills/` is grounded **inline**,
Wikipedia-style: a plain link where the claim is made, no citation
template. What matters is the *kind* of source, which the link target
carries by construction:

- a journal day (`../journals/archive/2026/09/2026-09-07.md`; a section of
  a month file, `../journals/2026-09.md#2026-09-07`, in format 1) — a
  decision or observation this brain made;
- raw material (`../raw/customer-call-2026-09-07.md`) — a source this brain
  holds but does not compile;
- an external URL — a page outside the brain;
- another brain (`brain://…`, below) — knowledge that lives closer to its
  implementation;
- nothing — an admitted assumption, which the text says in words ("assumed",
  "untested").

Journal entries are primary sources and need no grounding. A doc in
`knowledge/` or `skills/` with zero outbound links is an orphan (OKF) and,
in a brain, an *ungrounded* orphan; the template's contract fails it.

## Data flow architecture

The **write path** promotes: `raw/` → `journals/` → `knowledge/` →
`skills/`. When a more distilled doc is written, the less distilled one
gains a pointer to it ("now covered by [skill]") rather than a copy — DRY
by pointer, in the direction of distillation.

A brain is shared memory held in Git. The read path therefore begins with
**pulling the brain's latest version** (every mounted brain) and the write
path ends with a push; the first skill states both. Engines MAY report a
checkout that is behind its remote, and MUST NOT pull on the agent's behalf.

The **read path** is the mirror: `skills/` first, then `knowledge/`, then
`journals/`, and `raw/` only by grep, to ground or to distil. Engines
MUST reflect this in `brain_overview` by listing skills — the *type*, not
the folder — in their own `skills` section (spec/70) and in the keyword
ranking by the skill boost (spec/50). Ranking is engine-side; the order is
normative for the template and the first skill.

## `[brain]` config

A brain declares itself in the shared `brainpick.toml` (spec/80), next to
`[bundle] id`. All keys are optional; a bundle with no `[brain]` section is
a wiki, not a brain.

```toml
[brain]
format = 2                         # brain-format version this brain follows
origin = "git@github.com:me/x.git" # canonical git URL — how other people find this brain
audience = "personal"              # personal | team | public — who reads and writes here
readers = []                       # for team: who, by handle or role — decides what to assume
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `format` | integer | `0` (absent → not a brain) | the brain-format version; engines serve every version they know and print a migration hint for older ones |
| `origin` | string | `""` | the canonical git URL; a lookup key, never an identity (identity is `[bundle] id`) |
| `audience` | `personal` \| `team` \| `public` | `personal` | who this brain is written for — decides what is documented and what may be assumed |
| `readers` | list of strings | `[]` | for `team`: the people or roles the brain assumes as readers |

Environment overrides follow spec/80: `BRAINPICK_BRAIN_FORMAT`,
`BRAINPICK_BRAIN_ORIGIN`, `BRAINPICK_BRAIN_AUDIENCE`. `readers` has no env
override (lists are not env-shaped). Unknown values of `audience` warn and
fall back to `personal`.

## Cross-brain links

A brain addresses another with a `brain://` link whose authority is
**slug-then-id**, Notion-style: a human-readable slug followed by the
target's 21-char `[bundle] id`, then the bundle-relative path.

```
brain://personal-brain-k7f3m2x9q1w8e5r4t7y6u/knowledge/lancedb.md
       └── slug ─────┘ └──────── id ─────────┘ └──── path ──────┘
```

- The **id** (the last 21 `[a-z0-9]` characters before the first `/`) is
  authoritative. Resolvers look it up in the registry (spec/75) and map it to
  a local clone or a served brain.
- The **slug** is ignored by resolvers and exists for the reader; a rename
  never breaks a link.
- The **path** is bundle-relative, exactly as an in-brain rooted link
  (spec/20) without the leading slash.

Link extraction (spec/20) records `brain://` links with `kind: "brain"`,
`brain_id` and `path`; they are neither resolved nor counted as ghosts by
compile. Resolution is a federation concern (spec/75) and is out of scope
for this version of the format.

## Subsidiarity

When two brains hold conflicting information, the brain **closer to the
implementation** wins. This is a procedure, not an engine rule: the
template's `skills/using-the-brain.md` instructs the agent to update both
brains, then decide whether the information stays duplicated (readers of one
brain may not reach the other) or becomes a `brain://` pointer.

## Versioning and migration

`[brain] format` is the stamp. Format `2` is this document; format `1`
differs in the journal rhythm (a month per file, a flat archive) and in
keeping `_todo.md` beside the brain — both described above. A later format:

- changes bytes in committed brains only through `brainpick migrate --to N`,
  a deterministic rewrite with a dry-run diff that bumps the stamp — never
  silently on compile;
- keeps every earlier format servable (adapters, not refusals);
- follows the additive-only frontmatter policy above.

Artifacts under `.brainpick/` are disposable (spec/00); a format change never
needs a migration for them.

### `brainpick migrate --to N`

`migrate` is the one command that rewrites committed bytes. It is
deterministic — the same bundle in, the same bundle out, on either engine
(conformance class `migrate`) — and it is a *mechanical* rewrite: it moves
and splits files and edits links, the stamp and the format's config
defaults, never prose. It **writes by
default** (one command for an agent; git is the undo) and prints every
action it took as one line each, so the resulting commit reviews itself;
`--dry-run` prints the same action list plus a unified diff of every file it
would change and writes nothing. It refuses a target below the bundle's
current stamp, and a bundle already at the target is a no-op that says so.
A bundle without a `[brain]` section is not a brain and is refused.
Migrating never compiles; the caller compiles afterwards (the compile
pipeline is not touched, and `.brainpick/` stays disposable).

Every step is applied to the bundle root `R` (the folder `[bundle] root`
names) and the repo root `P` (where `brainpick.toml` lives; `P == R` when
the root is `.`). `today` is the engine's local date unless
`BRAINPICK_TODAY=YYYY-MM-DD` is set (conformance sets it).

**1 → 2**, in this order:

1. **Journals by day.** For every `R/journals/YYYY-MM.md` and
   `R/journals/archive/YYYY-MM.md` (format 1's flat archive): split the file
   into day files at its `## YYYY-MM-DD` headings. Text before the first day
   heading is dropped only if it is the month's `# YYYY-MM` title and blank
   lines; anything else is kept as the preamble of the first day. Each day
   file is `# YYYY-MM-DD` + a blank line + the section body; a `###` heading
   inside a section is promoted one level (`##`); `##`-level content that is
   not a date heading stays under the day it followed. A day equal to
   `today` lands at `R/journals/YYYY-MM-DD.md`; every other day at
   `R/journals/archive/YYYY/MM/YYYY-MM-DD.md`. A month file with no day
   heading at all becomes a single day file named for the month's first day.
   The month files are removed. Relative links inside a moved section are
   re-rooted so they still land (`../skills/x.md` from
   `journals/2026-07.md` becomes `../../../../skills/x.md` from
   `journals/archive/2026/07/2026-07-01.md`).
2. **Links to days.** Everywhere in the bundle (every `.md` under `R`):
   a link whose target resolves to a month file with a `#YYYY-MM-DD`
   fragment is rewritten to the day file that section became, relative to
   the linking doc, without a fragment; the same target with no fragment
   (or a fragment that is not a day) is rewritten to the month's earliest
   day file. Link text is untouched.
3. **To-dos into the brain.** If `P/_todo.md` exists: `R/todo/open.md` is
   created with frontmatter `type: todo`, `title: Open`,
   `description: What is still to be done — the brain's live work queue.`,
   `timestamp: <today>T00:00:00Z`, followed by `# Open`, a blank line and
   the body of `_todo.md` with its own first `# ` title line removed and
   its relative links re-rooted from `P` to `R/todo/` so they still land;
   then `_todo.md` is deleted and a `_todo.md` line, if present, is removed from
   `P/.gitignore`. `R/todo/index.md` is created when absent with a fixed
   body (below). If `_todo.md` does not exist, `todo/` is created with
   `index.md` and an empty `open.md` (the same frontmatter and a body of
   `# Open` only). An existing `todo/open.md` is left alone.
4. **The stamp.** `format = 1` under `[brain]` in `P/brainpick.toml`
   becomes `format = 2` in place (the line is rewritten, comments after it
   kept, nothing else in the file touched).
5. **The format's config defaults.** Format 2 ranks by half-life (spec/80
   `[half_life]`); a migrated brain gets the same defaults a freshly
   scaffolded one has. When `P/brainpick.toml` has no `[half_life]` section,
   the fixed block below is appended after a blank line; when it has one,
   nothing is added. This is the one step that writes config rather than
   content, and it only ever adds a section that was absent.

The fixed `[half_life]` block:

```toml
# Memories fade — slowly (spec/50). A doc's search score is multiplied by
# 2^(-age / half_life) on its `timestamp`, floored at 1/16: nothing is hidden,
# it only ranks lower. STEEPEN the curve here (fewer days) instead of deleting;
# a page can pin itself with `half_life: 0` in its frontmatter.
[half_life]
default = 365           # days; 0 = never fades
[half_life.folders]     # folder → days, the most nested folder wins
journals = 180          # episodic memory fades first
todo = 90               # an open list should be a fresh list
skills = 0              # procedural memory never fades
```

The fixed `todo/index.md`:

```markdown
# Todo

The brain's own work queue: `open.md` is the live list, `archive/` holds
what was closed, one file per day.

- [Open](open.md)
```

The action list is one line per act, in the order performed, each of the
form `split journals/2026-07.md → 3 day files`, `move journals/2026-07.md
… → journals/archive/2026/07/2026-07-01.md` (one per day), `rewrite links
in knowledge/kahvi.md (2)`, `move _todo.md → todo/open.md`, `create
todo/index.md`, `stamp brainpick.toml: format 1 → 2`, `add [half_life] to
brainpick.toml`. The tally the
conformance case fixes is the resulting bundle's bytes, not the wording.

Migrations are cumulative: `--to 3` from format 1 runs 1 → 2 then 2 → 3.

A brain whose stamp is below the format its engine writes is told so at
every compile, in the AGENTS.md report and in `brain_overview` — the
what's-new notice of spec/80 (*The release ledger*), whose format part
names the exact `migrate` command — until it is migrated.

## Conformance

Class `brain`:

- `[brain]` parses with the defaults above, env overrides apply, unknown
  `audience` warns (both engines).
- `brain://` links are extracted with `kind: "brain"`, `brain_id` and `path`,
  and excluded from ghosts.
- A fixture brain (`spec/fixtures/bundles/kotiaivot/`) with the template's
  layout — two `type: skill` docs where one depends on the other and
  drives a tool under `tools/`, a `type: playbook` how-to that is not
  a skill, a `todo/open.md` list with open and done items and a
  `todo/archive/` day file — compiles to
  golden T1 artifacts carrying the `depends_on` edge (spec/20), a
  `t1/todos.json` with every checklist item, a
  `skills/skilltree.md` byte-identical across engines, and an AGENTS.md
  report block with a `Skills` section; nothing under `raw/` appears in the
  manifest.
- `brain_overview` reports `todos: {"open": n, "done": m}` for the fixture;
  a keyword search that only a to-do item's text matches finds the list
  (`todo/open.md`) and the hit carries `todo: {"open", "done"}`.

Class `migrate`:

- A format-1 fixture (`spec/fixtures/bundles/kotiaivot-v1/`: a month file
  with two days and a `###` sub-heading, a flat-archived earlier month, a
  knowledge page linking to a day section and to the month, a `_todo.md`
  and a `.gitignore` listing it — shipped as `gitignore`, which the harness
  renames to `.gitignore` in the working copy so the repo's own ignore
  rules never swallow the fixture; the golden tree ships it the same way —
  `format = 1`) migrated with `--to 2` and
  `BRAINPICK_TODAY` fixed to the later day yields a bundle byte-identical
  to the golden tree under `spec/fixtures/expected/kotiaivot-v1/migrated/`
  (every file, including the deleted ones being absent — the golden's
  `brainpick.toml` carries the stamp and the appended `[half_life]` block);
  `--dry-run` leaves the fixture byte-identical to itself. Both engines
  natively.
- `brain_overview` lists both skills under `skills` with their prerequisites
  and tools; `brain_read` on the dependent skill returns its `skill` block
  (spec/70); a keyword search whose terms match a skill's trigger
  description ranks that skill above a prose doc with the same terms
  (spec/50) — a conformance `query` case asserts the ORDER.
- `[bundle] exclude` is honoured by every scan — manifest, graph, freshness
  (spec/80) — in both engines.
