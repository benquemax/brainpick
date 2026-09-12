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
brain material. Project management that is neither evergreen knowledge nor
an episode — `_todo.md`, scratch — stays **beside** the brain, not in it.

## Folders are memory types

| Folder | Memory type | Holds | Reserved files |
|---|---|---|---|
| `knowledge/` | semantic | evergreen concept docs, one concept per page | — |
| `skills/` | procedural | distilled, actionable procedures (`type: skill`) and, beside them, the `tools/` they drive | `skilltree.md` (generated) |
| `journals/` | episodic | one file per month, `YYYY-MM.md`, a `## YYYY-MM-DD` section per day, newest first; only the current month at the top level, earlier months in `journals/archive/` | `index.md` |
| `vision/` | direction | the northstar as a book; `index.md` is its table of contents | `index.md` |
| `plans/` | decided work | one plan per page; undecided ideas do not belong here | `index.md` |
| `raw/` | *(not a memory type)* | undistilled source material — transcripts, exports, clippings — that knowledge grounds on; no frontmatter, kebab-case, listed in its index, **excluded from the compiled brain** via `[bundle] exclude = ["raw/*"]` | `index.md` |

Every folder MAY hold sub-folders. The five memory types are
**sufficient**: a memory type that does not fit is a `type` value or a
sub-folder, never a seventh sibling. Engines MUST tolerate brains that omit
any folder (an empty memory type is simply empty) and MUST NOT depend on
any being present.

Journals are logs, not concept docs: no frontmatter, every heading an ISO
date. A month per file caps the length forever; the **month roll** — moving
last month's file into `archive/` before the first entry of a new month —
is the agent's act (taught by the first skill) and the contract's check
(the template allows one file at the top of `journals/`), never an engine
command: the engine does not know the layout.

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
| `export` | skills | `agent-skill` | the doc is also exported as a harness-loaded Agent Skill (`SKILL.md`) by `brainpick integrate` |

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

**Additive-only policy.** A brain-format key, once published, is never
renamed or removed; a newer format adds keys, and every key is optional for
at least one format version after it appears. An engine MUST ignore keys it
does not know (spec/20 already requires this for arbitrary frontmatter).

## Grounding

Every claim in `knowledge/` and `skills/` is grounded **inline**,
Wikipedia-style: a plain link where the claim is made, no citation
template. What matters is the *kind* of source, which the link target
carries by construction:

- a journal section (`../journals/2026-09.md#2026-09-07`) — a decision or
  observation this brain made;
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
format = 1                         # brain-format version this brain follows
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

`[brain] format` is the stamp. Format `1` is this document. A later format:

- changes bytes in committed brains only through `brainpick migrate --to N`,
  a deterministic rewrite with a dry-run diff that bumps the stamp — never
  silently on compile;
- keeps every earlier format servable (adapters, not refusals);
- follows the additive-only frontmatter policy above.

Artifacts under `.brainpick/` are disposable (spec/00); a format change never
needs a migration for them.

## Conformance

Class `brain`:

- `[brain]` parses with the defaults above, env overrides apply, unknown
  `audience` warns (both engines).
- `brain://` links are extracted with `kind: "brain"`, `brain_id` and `path`,
  and excluded from ghosts.
- A fixture brain (`spec/fixtures/bundles/kotiaivot/`) with the template's
  layout — two `type: skill` docs where one depends on the other and
  drives a tool under `tools/`, and a `type: playbook` how-to that is not
  a skill — compiles to
  golden T1 artifacts carrying the `depends_on` edge (spec/20), a
  `skills/skilltree.md` byte-identical across engines, and an AGENTS.md
  report block with a `Skills` section; nothing under `raw/` appears in the
  manifest.
- `brain_overview` lists both skills under `skills` with their prerequisites
  and tools; `brain_read` on the dependent skill returns its `skill` block
  (spec/70); a keyword search whose terms match a skill's trigger
  description ranks that skill above a prose doc with the same terms
  (spec/50) — a conformance `query` case asserts the ORDER.
- `[bundle] exclude` is honoured by every scan — manifest, graph, freshness
  (spec/80) — in both engines.
