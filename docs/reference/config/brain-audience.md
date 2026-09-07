---
type: reference
about: thing
title: "brain.audience"
description: "Who a brain is written for — personal, team or public — which decides what gets documented and how much context a page may assume; unknown values warn and fall back to personal."
tags: [config, spec, brain-format]
timestamp: 2026-09-07T11:30:00Z
---

# brain.audience

`audience` under `[brain]` names who reads and writes this brain: `personal`
(default) — one reader, who may assume everything they already know; `team` —
a named set of readers ([brain.readers](brain-readers.md)), written for the
least informed of them; `public` — assume nothing. Any other value warns and
falls back to `personal`.

The key answers a question every writing agent faces: how much to document and
how much to leave implicit. It is called *audience* rather than *scope* because
scope means too many things (a search scope, a config scope, a project scope) —
this key is about people. Env override: `BRAINPICK_BRAIN_AUDIENCE`. How audience
interacts with where information lands is in
[Brain subsidiarity](../../brain-subsidiarity.md).

Back to [Configuration reference](../../reference-config.md).
