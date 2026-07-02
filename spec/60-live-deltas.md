# Live deltas

`GET /api/live` streams Server-Sent Events. The graph a client renders MUST
be reconstructible from this stream alone — never a page refresh.

## Events

```
event: hello
id: 4212
data: {"seq":4212,"spec_version":"0.1","tiers":{"t1":"fresh","t2":"off","t3":"off"}}

event: graph.delta
id: 4213
data: {"added":{"edges":[…],"nodes":[…]},
       "cause":{"paths":["kuu.md"],"tier":"t1"},
       "removed":{"edges":[{"kind":"link","source":"a.md","target":"b.md"}],"nodes":["b.md"]},
       "seq":4213,
       "stats":{…},
       "updated":{"nodes":[…]}}

event: graph.snapshot
id: 4213
data: {"graph":{…full t1/graph.json payload…},"seq":4213}

event: compile.status
data: {"seq":4213,"state":"running","tier":"t1"}

: ping
```

- `hello` opens every connection, carrying the current `seq`.
- `graph.delta`: node objects in `added.nodes`/`updated.nodes` are FULL
  node records (as in `graph.json`); removals are ids (nodes) and
  `{source,target,kind}` triples (edges). An edge whose `count`/`label`
  changed appears in `removed.edges` + `added.edges`. `stats` is the new
  full stats object.
- Deltas are whole-graph diffs between consecutive compiles — correctness
  MUST NOT depend on watcher event fidelity, and compiles by other
  processes (cron, the sibling engine) MUST produce deltas too (servers
  watch the manifest `seq`).
- SSE `id` equals `seq`. Servers keep a ring buffer (≥ 256 deltas); a
  reconnect with `Last-Event-ID` inside the buffer replays missed deltas,
  otherwise the server sends one `graph.snapshot` to resync.
- `compile.status.state` is `running`, `done`, or `failed` (clients treat
  unknown values as `done`).
- The graph's top-level `tags` map is NOT carried by deltas — clients that
  need it live derive it from node records (`stats.tags` carries the count).
- A client reconnecting WITHOUT `Last-Event-ID` while holding state compares
  the `hello` seq to its own: ahead → resync via `GET /api/graph`; equal →
  continue. Replayed deltas are idempotent by seq — clients apply a delta
  only when `delta.seq == local_seq + 1` and ignore older ones.
- Heartbeat comment (`: ping`) at least every 30 s.
- Watcher hygiene: debounce ≥ 200 ms, coalesce bursts, ignore
  `.brainpick/`, `.git/`, `_temp/`, `node_modules/`; unchanged content
  hashes MUST NOT produce deltas or bump `seq`.

## Planned event types (reserved names, post-0.1)

`ui.presentation` — agent-driven highlight/tour commands relayed to open
UIs (the `brain_show` feature).
