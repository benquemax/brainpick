---
type: article
about: concept
title: "To-do lists"
description: "Open work as part of the brain — a type: todo doc's checklist lines compile into todos.json, the overview counts them, a search hit says how many are open, and the day-per-file archive makes done an episode with a date; brainpick indexes the list and never edits it."
tags: [brain-format, agents]
timestamp: 2026-09-13T12:00:00Z
---

# To-do lists

A parking lot is memory too. Under brain format 1 the to-do list lived
*beside* the [brain](brain.md) as `_todo.md` — project management, not
knowledge — which made it invisible to `brain_search`: an agent asked "is
anything about X still open?" had to grep. Format 2 moves it in. The
template keeps `todo/open.md`, the live list, and `todo/archive/
YYYY-MM-DD.md`, what was closed that day — the same day-per-file rhythm as
the [journals](data-flow-architecture.md), so `open.md` stays small and
"done" is an episode with a date a knowledge page can
[ground](grounding.md) on.

The engine does not know the folder ([Structure agnosticism](structure-agnosticism.md)).
It keys on `type: todo`, exactly as a [skill](skills.md) is a skill by its
`type`: every checklist line in such a doc — `- [ ] text` open, `- [x]
text` done, any bullet, any indentation, fenced code skipped — is one item.
A trailing `(done: YYYY-MM-DD)` dates the item; otherwise a done item takes
its list's `timestamp` date, which in the archive is the day the file is
named for. [Compile](compile-pipeline.md) writes them to `t1/todos.json`
([Spec: T1 artifacts](reference/spec/t1-artifacts.md)) sorted by path and
line, part of the freshness gate like `skills.json`, `{"todos": []}` in a
wiki without lists.

Three surfaces read it. [brain_overview](reference/mcp/brain-overview.md)
always carries `todos: {open, done}` and, when work is open, its hint says
how many and names the busiest list — an agent that reads only the first
line of its first call knows there is a queue. A
[brain_search](reference/mcp/brain-search.md) hit that is a to-do list adds
`todo: {open, done}` for that list, so the answer to "still open?" is in
the hit itself, no read needed. And the list is an ordinary document
otherwise: its items' text is part of the searchable text, it sits in the
graph, `brain_read` returns it as written. The CLI mirrors print the same
counts (`todos: 2 open · 2 done` in `brainpick overview`, `[2 open · 1
done]` on a search hit).

What the engine never does is tick a box. Closing an item — flipping `[ ]`
to `[x]`, moving the line to today's archive file — is
[brain_write](reference/mcp/brain-write.md) or the agent's editor; the
template's first skill teaches the move, and the henxels contract can check
that `open.md` holds no `[x]` lines older than today. Reading is the
engine's whole job ([Spec: brain format](reference/spec/brain-format.md),
*To-do lists*).

This repository dogfoods the rule in spirit and not yet in file: its own
`_todo.md` is gitignored scratch beside a wiki, not a brain, and stays
there until the wiki becomes a brain of its own.
