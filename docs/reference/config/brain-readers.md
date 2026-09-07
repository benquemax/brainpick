---
type: reference
about: thing
title: "brain.readers"
description: "For a team brain, the people or roles it assumes as readers — by handle or role name — so a writing agent knows whose context it may take for granted."
tags: [config, spec, brain-format]
timestamp: 2026-09-07T11:30:00Z
---

# brain.readers

`readers` under `[brain]` lists, for a `team` brain, who is assumed to read it —
by handle (`"tom"`) or role (`"backend-devs"`, `"agents"`). Default `[]`. It has
no env override (lists are not env-shaped). A `personal` brain leaves it empty;
a `public` brain leaves it empty and assumes nothing.

The list is advice to the writer, not access control — access is
[Authentication](../../authentication.md). Set the audience with
[brain.audience](brain-audience.md).

Back to [Configuration reference](../../reference-config.md).
