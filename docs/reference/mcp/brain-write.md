---
type: reference
about: thing
title: "brain_write"
description: "The one guarded write path — resolve, atomic write, henxels referee, rollback or recompile — with base_sha optimistic concurrency and a merge ladder."
tags: [mcp, agents]
timestamp: 2026-09-06T11:30:00Z
---

# brain_write

`brain_write({doc, content, mode?, base_sha?})` is the sanctioned
two-argument exception. Behind a federated server
([federation](../../federation.md)) `doc` may be `alias:path`; an unqualified
one writes to the brain the working directory is in, and without one the call
declines naming the aliases — it never guesses a target. `mode ∈ create|replace|append_section` (default
`create`). The flow: resolve `doc` to a kebab-case bundle path (rejecting
traversal), write atomically, run the henxels contract against that path,
roll back with the instruction *verbatim* on violation, else bump the
`timestamp`, recompile incrementally and emit the delta.

**Optimistic concurrency:** pass `base_sha` and, if it no longer matches, the
server refuses and returns a conflict — optionally with a `merged` proposal
(`three-way`, then an `llm` merge via [models.extraction](../config/models-extraction.md),
else manual). It is exposed only when [serve.writes](../config/serve-writes.md)
is `guarded` and, off localhost, only with a token.

This is the [guarded writes](../../guarded-writes.md) path; its HTTP face is
`PUT /api/docs` in [Spec: REST API](../spec/rest-api.md). Back to [MCP tool reference](../../reference-mcp.md).
