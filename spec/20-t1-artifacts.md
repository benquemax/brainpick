# T1 artifacts

T1 is deterministic: no model calls, no randomness, no clock reads besides
the manifest's volatile `compiled_at`. All of T1's outputs below are
**normative** except where marked advisory.

## Document scanning

A document is any bundle file matching the include globs. Per document:

- `title`: frontmatter `title`, else the first `# ` heading, else the file
  stem with `-`/`_` replaced by spaces.
- `type`, `about`, `description`, `timestamp`: frontmatter fields, absent →
  `null`. `type`/`about` are opaque strings at this layer — any enum
  constraint on their values (a bundle's own two-axis ontology, say) is a
  bundle-governance concern, not a T1 one.
- `tags`: frontmatter list, absent → `[]`; non-list scalars wrap to a
  one-element list; values coerced to strings.
- `reserved`: `true` for any `index.md`, `log.md` or `skilltree.md` (the
  generated skill tree, spec/85 — navigation, like the index).
- Frontmatter is the YAML mapping between a leading `---` line and the next
  `---` line; tolerant — unparseable YAML, a non-mapping, or values the
  dialect resolves but cannot construct (an impossible date like
  `2026-02-31`, an out-of-range time) all yield `{}`, never an error.
- The YAML dialect is normatively **PyYAML-compatible 1.1 resolution**:
  ISO-ish scalars resolve to timestamps (constructor regex stricter than
  resolver: `2026-6-1` stays a string), `yes/no/on/off/y/n` follow PyYAML
  (not spec-pure 1.1 — bare `y`/`n` stay strings), sub-second digits
  truncate, duplicate keys last-wins, unknown tags degrade the mapping to
  `{}`. Non-Python engines must match PyYAML's resolution, not their YAML
  library's defaults.

## Link extraction

From each document body (frontmatter stripped, fenced code blocks and
inline code spans excluded):

1. **Markdown links** `[text](target)` where target has no URI scheme and
   is not an in-page `#fragment`. A trailing `#fragment` is stripped.
   - Rooted targets (`/a/b`): resolve from the bundle root as `a/b`, then
     `a/b.md`, then `a/b/index.md` — first hit wins.
   - Relative targets: resolve from the document's directory (`.`/`..`
     normalized), as given, then with `.md` appended.
2. **Wikilinks** `[[target]]` / `[[target|text]]`: target resolves to the
   unique bundle document whose file stem equals it (case-sensitive exact
   match first, then case-insensitive); zero or multiple matches → ghost.

A resolved link is an edge; an unresolved one is a **ghost**. Self-links
are dropped. Multiple links A→B collapse to one edge with `count` and the
first occurrence's text as `label`.

### Skills and frontmatter edges

A document is a **skill** when its `type`, trimmed and lowercased, is
`skill` (spec/85) — a `playbook` is a how-to for humans and is not one. Recognition is keyed on frontmatter only —
never on a folder name — and reserved files are never skills. A skill's
frontmatter MAY carry two brain-format keys the engine consumes:

- `depends_on`: a list of doc targets this skill assumes. Each entry
  resolves like a rooted link target from the bundle root (`a/b`, `a/b.md`,
  `a/b/index.md`), then like a relative target from the skill's own
  directory. A resolved entry is an edge with `kind: "depends_on"`, `count`
  1 and the **target's title** as `label`; an unresolved entry is a ghost,
  exactly like a dangling link, so an unwritten prerequisite shows in the
  ghost queue. Self-dependencies are dropped. Non-list scalars wrap to a
  one-element list; values coerce to strings.
- `tools`: a list of file paths — the deterministic scripts this skill
  drives. Each resolves from the bundle root, then from the skill's
  directory; a tool is a plain file the bundle holds (it is not a document:
  it never matches the include globs, never enters the graph). Engines
  index and point at tools; they **never execute them** — running a tool
  is the agent's act, under the agent's own sandbox and approval policy.

On a non-skill document both keys are ignored. `depends_on` edges count
toward `in`/`out`, orphan status and islands like any other edge.

## t1/graph.json (normative)

```json
{
  "edges": [{"count": 1, "kind": "link", "label": "Maa", "source": "kuu.md", "target": "maa.md"}],
  "ghosts": [{"source": "saaret/laguuni.md", "target": "olematon.md"}],
  "islands": [["saaret/atolli.md", "saaret/laguuni.md"]],
  "nodes": [{"about": "thing", "description": "The star everything in this bundle orbits.",
             "id": "aurinko.md", "in": 4, "orphan": false, "out": 3,
             "reserved": false, "tags": ["tähti"], "timestamp": null,
             "title": "Aurinko", "type": "Concept"}],
  "stats": {"docs": 10, "edges": 20, "ghosts": 1, "islands": 1, "orphans": 1, "tags": 8},
  "tags": {"koti": ["maa.md"], "tähti": ["aurinko.md"]}
}
```

- `nodes`: every document, sorted by `id`. `in`/`out` count graph edges
  (ghosts excluded). `kind` is `link`, `wikilink` or `depends_on` (a
  skill's declared prerequisite — see *Skills and frontmatter edges*).
- `edges`: sorted by (`source`, `target`, `kind`). `ghosts`: sorted by
  (`source`, `target`).
- `orphan`: a non-reserved node with zero inbound edges from non-reserved
  nodes (links from `index.md`/`log.md` are navigation, not knowledge).
- `islands`: connected components of the undirected graph over
  non-reserved nodes, EXCLUDING the largest component (the mainland); each
  island sorted by id, islands sorted by (size desc, first id). Tie for
  largest: the component containing the lexicographically smallest id is
  the mainland.
- `tags`: tag → sorted list of node ids; keys sorted. `stats.tags` counts
  distinct tags; `stats.islands` counts listed islands.

## t1/docs.jsonl (normative)

One line per document, sorted by `path` — the substrate for keyword search
and reading:

```json
{"about":"thing","description":null,"path":"aurinko.md","reserved":false,"sha256":"…","tags":["tähti"],"text":"…body without frontmatter…","timestamp":null,"title":"Aurinko","type":"Concept"}
```

`text` is the body with frontmatter removed, original line endings
normalized to LF, without further transformation.

## t1/skills.json (normative)

The skills of the bundle (*Skills and frontmatter edges*), the substrate
`brain_overview`, `brain_read` and the report block draw on so none of them
re-parses frontmatter:

```json
{
  "skills": [
    {"depends_on": ["skills/veden-keitto.md"], "description": "Use when brewing the morning coffee.",
     "path": "skills/kahvin-keitto.md", "title": "Kahvin keitto", "tools": ["tools/keita"]}
  ]
}
```

Sorted by `path`; `depends_on` holds only the **resolved** prerequisites in
declared order (ghosts are in `graph.json`); `tools` holds the declared
tool paths, resolved to bundle-relative form when the file exists, kept as
declared otherwise. Written on every full compile, `{"skills": []}` when
there are none; part of the freshness comparison like `graph.json`.

## Generated index.md

Mode `section` (default): brainpick owns only the fenced block, appended at
end of file (or created, with `okf_version: "0.1"` frontmatter, if the file
is absent). Mode `manage`: brainpick owns the whole file below the
frontmatter. Mode `off`: untouched.

```markdown
<!-- brainpick:begin index (hash:9f2ab1c3) -->
_Generated by `brainpick compile` from frontmatter descriptions — edit the
docs' `description` fields, not this block._

## concepts

- [Aurinko](aurinko.md) — the star everything orbits
…
<!-- brainpick:end index -->
```

- Groups: one `## <group>` section per directory that contains documents.
  The bundle root's group heading is the literal word `concepts`; every
  subdirectory's heading is its bundle-relative POSIX path (e.g. `saaret`).
  Root group first, then subdirectories in lexicographic order.
- Entries: `- [Title](path) — description` (em dash), description omitted
  (entry ends at the closing parenthesis) when `null`; reserved files are
  never listed; entries sorted by title (locale-independent codepoint
  order).
- `hash:` stamp: first 8 lowercase hex chars of sha256 over the block body
  — the bytes strictly between the begin-line's trailing LF and the
  end-line, exclusive.

## Generated AGENTS.md brain report (opt-in)

When a bundle's repo has an `AGENTS.md` containing the markers
`<!-- brainpick:begin report (hash:…) -->` / `<!-- brainpick:end report -->`
(installed by `brainpick integrate`), compile refreshes the block between
them — same fence mechanics as the index (hash stamp over the body; absent
markers → never touched; the file itself is never created by compile).
Body (normative order, one line each unless noted): a one-line directive
("consult brain_search/`brainpick search` BEFORE grepping this bundle"),
counts (docs · links · tags · orphans · ghosts), tier status, top 5 hub
documents by total degree (`- title (path) — in/out`), orphans list (≤5),
the top 5 ghost queue by reference count (`- target — count refs`, highest
first, target path tie-break; counts distinct source docs referencing that
target — see `top_ghosts` below), the top 5 similarity-gap pairs by score
(`- a ↔ b — score`, highest first, pair tie-break by (`a`, `b`); spec/45) —
present only when `t1/similarity-gaps.json` exists, omitted entirely (not an
empty section) when T2 or the module is off — the skills section, and the
bundle root. The skills section (`- Skills (read before improvising):`)
lists every skill as `- title (path) — description` sorted by path,
description omitted when `null`, with `  · tools: a, b` appended when the
skill declares tools; it is present only when the bundle holds at least one
skill, omitted entirely otherwise (a wiki is not a brain).
Deterministic; cross-engine byte-identical (a conformance golden accompanies
the first implementation).

## Generated skills/skilltree.md

When the bundle declares itself a brain (`[brain] format ≥ 1`, spec/85)
and holds at least one skill, compile writes `skilltree.md` into the
directory of the first skill by path (the template's `skills/`) — before
the scan that produces the artifacts, like `index.md`, so the manifest
records it as written and `--check-fresh` sees a stale tree. A wiki (no
`[brain]` section) never gets one — its contract did not plan for the
file — and an existing `skilltree.md` is left alone when no skill remains.
The file is reserved like `index.md`/`log.md`: frontmatter-free, never a
skill, never listed in the index, its links navigation rather than
knowledge. It is regenerated whole — there is no hand-written part.

```markdown
# Skill tree

_Generated by `brainpick compile` from `depends_on` frontmatter — edit the
skills, never this file._

- [Kahvin keitto](kahvin-keitto.md) — Use when brewing the morning coffee.
  - needs [Veden keitto](veden-keitto.md)
  - tools: `../tools/keita`
- [Veden keitto](veden-keitto.md) — Use when you need boiling water.
```

One top-level entry per skill sorted by path, link text the title, link
target relative to the file; under it one `needs` line per resolved
prerequisite in `depends_on` order, then one `tools:` line listing the
declared tool paths relative to the file, each in backticks, comma-joined.
Lines are omitted when empty. A ghost prerequisite is not listed (it is in
the ghost queue). A cycle is reported as a compile warning naming the
skills; the tree still renders every skill exactly once.

## Advisory T1 artifacts

- `t1/layout.json`: 2D positions, 3D brain positions, community
  assignments. Engines MAY produce it; the UI recomputes when absent.
- `t1/timeline.json`: per-document created/modified events from git
  history and `log.md`. Absent on non-git bundles.
