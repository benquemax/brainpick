# MCP tools

Both engines expose the same six tools, verbatim, over stdio
(`brainpick mcp`), streamable HTTP (`/mcp`), and legacy SSE (`/sse`).
Small-model ergonomics are normative: at most one required argument
(`brain_write` is the sanctioned exception — `doc` and `content`),
unknown enum values fall back to defaults with a note (never an error),
every result carries a `hint` string naming a sensible next call, and every
tool accepts `budget_tokens` (int; chars/4 estimate; results are shaped to
fit — descriptions survive first, snippets/bodies are trimmed, and a
truncated result says so and how to get the rest).

When one server fronts several brains (spec/75), every path in these
payloads is qualified `alias:path`, `brain_search`/`brain_overview` take
`scope`, and `brain_overview` adds `brains`; a single-brain server emits
exactly the shapes below.

## brain_overview({scope?, budget_tokens?})

No required args. → `{"bundle", "counts": {"docs", "edges", "tags",
"orphans", "ghosts"}, "tiers", "tree": [{"group", "docs": [{"path",
"title", "description"}]}], "top_ghosts": [{"target", "count"}],
"similarity_gaps_open_count", "hint"}`.
`top_ghosts` is the write-next queue — up to 5 ghost link targets, highest
reference count first (target path tie-break), always present (`[]` when
there are none), never subject to budget trimming (bounded size already).
`similarity_gaps_open_count` (spec/45) is the count of unresolved
similarity-gap pairs — always present, `0` when T2 or the module is off,
never budget-trimmed. Default budget 800.

`skills` (spec/20 *Skills and frontmatter edges*) is always present: every
skill in the brain as `{"path", "title", "description", "depends_on":
[paths], "tools": [paths]}`, sorted by path, `[]` when there are none.
Skills are the read path's first stop (spec/85), so they are listed apart
from the folder tree — an agent that reads only the overview learns which
procedures exist before it improvises one. Budget trimming empties the
`tree` before it touches `skills`. When skills exist, `hint` says so and
names `brain_read` as the way to a skill's prerequisites and tools.

`todos` (spec/20 *t1/todos.json*) is always present: `{"open": n, "done":
m}`, the counts of to-do items across every to-do list in the brain —
`{"open": 0, "done": 0}` when there are none. Never budget-trimmed. When
items are open, `hint` says how many and names the list with the most
(`brain_read <path>` opens it).

`update` (spec/80 `[update] check`) is present only when a newer engine
version is known: `{"current", "latest", "hint"}`, `hint` the exact upgrade
command. The overview `hint` then starts with the notice — an agent that
reads only the first line of its first call learns it. Never budget-trimmed
(three short strings); absent, not `null`, when there is nothing to say.

`whats_new` (spec/80 *The release ledger*) likewise: present only when
the ledger has something for this brain — releases since it was last
compiled, or a brain format newer than its stamp — as the notice object,
and then `hint` starts with `What's new — <hint>. ` (after the update
notice's prefix when both exist). Never budget-trimmed; absent when
there is nothing to say.

## brain_search({query, mode?, limit?, scope?, budget_tokens?})

`mode ∈ auto|keyword|semantic|graph` (default `auto`). → `{"hits":
[{"path", "title", "description", "score", "why"}], "used_modes",
"degraded_from", "truncated", "hint"}`. Descriptions only — never full
bodies. `why` is one clause naming the match reason. A hit that is a
to-do list (spec/20 *To-do lists*) adds `"todo": {"open": n, "done": m}`
— its item counts, so "is X still open?" is answered by the hit itself;
absent on every other hit. Default budget 1200.

## brain_read({doc, sections?, budget_tokens?})

`doc` resolves forgivingly: exact path → unique file stem → fuzzy title;
an ambiguous resolution returns `{"disambiguation": [{"path", "title"}]}`
instead of content. → `{"path", "frontmatter", "outline": ["## …"],
"content", "neighbors": {"in": [...], "out": [...]}, "truncated", "hint"}`
where neighbor entries are `{"path", "title"}`. Over budget → outline +
leading excerpt + hint to request `sections`. Default budget 2000.

When the doc is a skill (spec/20), the payload adds `"skill": {"depends_on":
[{"path", "title"}], "dependents": [{"path", "title"}], "tools": [{"path",
"exists"}]}` — the resolved prerequisites (read them first), the skills that
build on this one, and the tools it drives, each with whether the file is
present in the bundle (`exists`). Missing prerequisites are ghosts and are
not listed here. The `hint` names the tools and says the agent runs them
itself — brainpick never executes a tool.

## brain_neighbors({doc, depth?, layer?, budget_tokens?})

`depth` 1–3 (default 1), `layer ∈ links|entities|both` (default `links`;
`entities` degrades to `links` with `degraded_from` until T3). →
`{"center", "nodes": [{"path", "title", "description", "distance"}],
"edges": [{"source", "target", "kind"}], "hint"}`. Default budget 800.

## brain_write({doc, content, mode?, base_sha?})

`mode ∈ create|replace|append_section` (default `create`). The guarded
write path:

1. Resolve `doc` to a bundle-relative kebab-case `.md` path (reject
   traversal outside the bundle).
2. Write atomically (temp + rename), then run the henxels contract that
   governs the bundle against that path (when one exists). The contract is
   `henxels.yaml` at the bundle root, or else at the git repository root
   above it (the brain-template layout, `henxels.yaml` beside `_brain/`);
   `henxels check` runs from the contract's directory with the target path
   relative to it, so the referee resolves the same rules the pre-commit
   hook does. The `henxels` executable is looked up on PATH first, then in
   the per-user launcher dirs (`$XDG_BIN_HOME`, `~/.local/bin`, the Python
   `Scripts` dirs on Windows), because a harness frequently spawns the MCP
   server with a stripped PATH that hides a `uv tool install henxels`.
3. Violations → restore the previous state and return `{"ok": false,
   "instruction": "<henxels output verbatim>"}`.
4. Pass → bump frontmatter `timestamp` (creating it if absent), trigger an
   incremental compile, emit the delta. → `{"ok": true, "path", "seq",
   "hint"}`.

**Optimistic concurrency (`base_sha`)**: writers SHOULD pass the sha256 of
the doc content they last read (available from the manifest, `docs.jsonl`,
or a future read response). When `base_sha` is present and differs from the
current file's sha256, the server MUST NOT write. It returns
`{ok: false, conflict: true, current_sha, theirs: <current content,
budget-shaped>, instruction: "the doc changed since you read it — re-read,
reconcile, retry with the new base_sha"}` — plus, when resolution is
possible, `merged: {content, strategy}` as a PROPOSAL (never auto-applied):

1. `strategy: "three-way"` — mechanical merge when base is known (git
   history or cached) and the edits do not overlap;
2. `strategy: "llm"` — a single-shot smart merge of base/theirs/yours
   through the configured `[models.extraction]` chat model, when one is
   configured — prose merges badly mechanically, so the model the brain
   already has doubles as the merge tool;
3. neither available → conflict response without `merged` (manual path).

Edge semantics: a doc DELETED since it was read conflicts with
`current_sha: null, theirs: null`. The `base_sha` comparison is evaluated
first, but a matching `base_sha` does not override `create`'s no-clobber
rule. Omitting `base_sha` preserves today's last-write-wins (writes stay
serialized server-side either way).

Servers expose `brain_write` only when config `[serve] writes = "guarded"`
(default) and, on non-localhost binds, only with a valid bearer token.

## brain_show({nodes?, focus?, mode?, annotation?, clear?})

Agent-driven presentations — spotlight a subgraph, fly the camera to `focus`,
switch `mode`, and caption it, pushed LIVE to every open UI (the agent side
reaching across to the human side). Every argument is optional; `nodes` accept
doc paths (fuzzy/kebab-resolved like `brain_read`) and entity names, unresolved
entries are dropped and listed, `focus` defaults to the first resolved node, and
an empty call or `clear: true` clears the current presentation. → `{"ok": true,
"shown": <resolved count>, "dropped": [<unresolved>], "seq", "hint"}` where `seq`
is a monotonic PRESENTATION counter distinct from the manifest seq. Unlike
`brain_write` it is ephemeral and advisory — it never writes the brain, so it is
NOT behind `[serve] writes`, only the normal auth. The presentation payload
shape, the `brain.show` live event, and `POST /api/show` are the contract of
`95-presentations.md`.

## Resources

`brain://index` (the generated index block) and `brain://doc/{+path}` (raw
document content). Optional in 0.1; hosts without resource support lose
nothing — the tools cover everything.
