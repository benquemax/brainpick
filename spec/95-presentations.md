# Presentations — agent-driven views (brain_show)

The brain is one surface two audiences share (principle 6). A presentation lets
the AGENT side reach across to the HUMAN side: an agent answering a question can
spotlight the subgraph it means, fly the human's camera to it, and caption it —
pushed live to every open UI. `brain_show` turns "let me explain" into "let me
show you."

A presentation is **ephemeral and advisory**: it changes what the UI
highlights/frames, never the brain itself (no write, no compile, no delta). It
is not conformance-golden; its payload shape is normative so both engines and
the UI agree.

## The presentation payload (normative shape)

```json
{
  "annotation": "The auth subsystem — tokens for agents, a password for humans.",
  "focus": "authentication.md",
  "mode": "brain",
  "nodes": ["authentication.md", "guarded-writes.md", "mcp-tools.md"],
  "seq": 7
}
```

- `nodes` — ids to spotlight: doc paths and/or entity render-ids (the same id
  space the graph/entity layers use). Unknown ids are dropped (see the tool).
  Empty `nodes` with no `focus`/`annotation` = CLEAR the current presentation.
- `focus` — a single id to centre/fly the camera to, or `null` (then the UI
  frames the `nodes` set). Must be in `nodes` or resolvable.
- `mode` — `"cosmos" | "brain" | null`; when set, the UI switches view.
- `annotation` — a short caption string, or `null`.
- `seq` — a server-assigned monotonic presentation counter (distinct from the
  manifest/graph `seq`); the UI applies the highest it has seen and ignores
  older, so out-of-order SSE frames never regress a presentation.

## brain_show (MCP tool, spec/70)

`brain_show({nodes?, focus?, mode?, annotation?, clear?})` — small-LLM-shaped:
every arg optional. Resolution:

- `nodes` accept doc paths (fuzzy/kebab-resolved like `brain_read`) and entity
  names; each resolves to a graph id. Unresolved entries are DROPPED, never an
  error — the response lists them so the model can correct.
- `focus` defaults to the first resolved node when omitted.
- `clear: true` (or an otherwise-empty call) broadcasts a cleared presentation.
- The server assigns `seq`, keeps the latest presentation as state, and
  broadcasts the event. Returns `{"ok": true, "shown": <resolved count>,
  "dropped": [<unresolved>], "seq", "hint"}`.

`brain_show` never writes the brain, so it is NOT behind `[serve] writes`; it is
gated only by the normal auth (a bearer token on a non-localhost bind).

## The live event (spec/60)

Server broadcasts `event: brain.show` with the presentation JSON as `data`, over
the same `/api/live` SSE stream as `graph.delta`. It carries the presentation
`seq`, NOT a manifest seq, and is excluded from the graph-delta ring buffer.
The server holds the LATEST presentation and replays it once to a newly
connected client (after the graph snapshot), so a UI joining mid-presentation
sees it. A cleared presentation is `{"nodes": [], "focus": null, "mode": null,
"annotation": null, "seq": N}`.

## REST + CLI (spec/50)

`POST /api/show` takes the tool's body `{nodes?, focus?, mode?, annotation?,
clear?}`, resolves + broadcasts identically, returns the same shape. Same auth
gate; independent of `[serve] writes`. `brainpick show <node...> [--focus id]
[--mode cosmos|brain] [--annotate text] [--clear]` posts to a running server —
the CLI/scripting face (and how the conformance/e2e exercises it).

## UI rendering (normative behaviour)

On `brain.show`, the UI: highlights `nodes` (reusing the search-highlight
path), switches `mode` if set, flies the camera to `focus` (the cosmos flyTo or
the brain search-flight), and shows `annotation` as a dismissible caption with
a "presented by an agent" marker. A new presentation replaces the previous; a
cleared one removes the highlight/caption. Presentations compose with every
view — cosmos, hologram, and time travel.
