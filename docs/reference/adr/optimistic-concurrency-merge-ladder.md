---
type: Decision
title: "ADR: optimistic concurrency and the merge ladder"
description: "Why concurrent writes resolve through a base_sha check and a three-way then LLM merge ladder whose proposals are never auto-applied, rather than last-write-wins or locks."
timestamp: 2026-07-08T00:00:00Z
---

# ADR: optimistic concurrency and the merge ladder

**Context.** Two writers — an agent and a human, or two agents — can edit the
same doc between read and write, and a brain must not silently lose an edit.

**Decision.** Use optimistic concurrency. A write may carry `base_sha`; if it no
longer matches, the server refuses with a conflict, optionally returning a merge
proposal — three-way first, then an LLM merge via [models.extraction](../config/models-extraction.md),
else manual. Proposals are never auto-applied, and the git base is trusted only
when it hashes to `base_sha`. The mechanism lives in [brain_write](../mcp/brain-write.md).

**Alternatives considered.** Last-write-wins (silent data loss); pessimistic
locking (hostile to offline and distributed writers). Rejected — loss is
unacceptable, and locks do not fit a files-are-the-brain, multi-writer model.

**Consequences.** Both engines return a byte-identical conflict response (see
[Runtime parity](../../runtime-parity.md)), and the human editor of
[ADR: the WYSIWYG editor on ProseMirror](wysiwyg-prosemirror-editor.md) shares the
same ladder as the agent tool through [Guarded writes](../../guarded-writes.md).
A stale write becomes a reviewable merge rather than a clobber; the HTTP mapping
is in [Spec: REST API](../spec/rest-api.md). Back to
[Architecture decision records](../../reference-adr.md).
