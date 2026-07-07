---
type: Decision
title: "ADR: the WYSIWYG editor on ProseMirror"
description: "Why the in-browser editor is built on ProseMirror with a byte-faithful markdown round-trip and lazy-loaded off the main bundle, writing through the same guarded path as brain_write."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: the WYSIWYG editor on ProseMirror

**Context.** Humans should be able to edit the brain from any device, but a rich
editor that reformats markdown would fight the OKF byte-faithful contract and the
henxels referee behind [Guarded writes](../../guarded-writes.md).

**Decision.** Build the editor on ProseMirror with prosemirror-markdown, proven
to round-trip every doc (tables included) byte-stably, lazy-loaded as a separate
chunk off the main bundle. Its link picker inserts the target's title as the link
text — the OKF convention of the [Wiki conventions](../../wiki-conventions.md) by
construction — and it saves through `PUT /api/docs`, the HTTP face of
[brain_write](../mcp/brain-write.md).

**Alternatives considered.** A plain-textarea markdown editor; a different
rich-text framework. Rejected — a textarea is a poor human surface on mobile, and
a non-round-tripping editor would corrupt bytes and trip the contract.

**Consequences.** One referee, one pipeline, now two mouths — an agent's MCP tool
and a human's editor — sharing the
[ADR: optimistic concurrency and the merge ladder](optimistic-concurrency-merge-ladder.md)
and the token gate of [Authentication](../../authentication.md); the editor cost
stays off the first paint, and it writes into the same
[Holographic brain](../../holographic-brain.md) users see. The status-code mapping
is in [Spec: REST API](../spec/rest-api.md). Back to
[Architecture decision records](../../reference-adr.md).
