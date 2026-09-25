---
type: article
about: concept
title: Read-only implants
description: "Mounting a brain you do not control — access = read-only in the registry makes brain_write refuse with a redirect, sync a pure fast-forward mirror, push a refusal that names brain_contribute; your own notes land in your cortex and surface back as annotations."
tags: [agents, mcp, brain, spec]
timestamp: 2026-09-25T16:00:00Z
---

# Read-only implants

Some of the best brains to mount are not yours. A public knowledge
implant — a philosophy corpus, a team's project brain you were given read
access to — is valuable *because* it tracks its upstream exactly. The moment
your local checkout diverges from the original repository, `git pull` stops
fast-forwarding (updating cleanly), your mirror rots, and nobody upstream
ever sees your correction.

So brainpick lets a mount say what it is. In
[federation](federation.md)'s registry an entry may carry one extra key:

```toml
[[brains]]
repo = "~/Git/brain-implant-philosophy"
alias = "philosophy"
role = "implant"
access = "read-only"
```

`access = "read-only"` is a **mount fact**, declared by
[brainpick register](reference/cli/register.md) `--read-only` — never
guessed from a URL or probed from the remote, because whether *you* may
push (publish commits) to a repository is something only you know. The
default is `read-write`; older registries without the key behave exactly
as before ([structure agnosticism](structure-agnosticism.md) applied to
config).

## What read-only changes

Three verbs change behavior; nothing changes shape:

- **[brain_write](reference/mcp/brain-write.md) refuses** with
  `access: "read-only"`, a `brain_link` (the [subsidiarity](brain-subsidiarity.md)
  address of the doc you aimed at), and an instruction naming both routes:
  write your *own* note in your cortex, or propose the fix upstream with
  `brain_contribute` — see
  [contributing to an implant](contributing-to-an-implant.md).
- **`brain_sync` becomes a pure mirror**: fast-forward only (take upstream's
  new commits, create none). A checkout that has somehow diverged is
  reported, never merged — a read-only mount is a copy, and a copy is
  never reconciled, only reset.
- **`brain_push` refuses at call time** and names `brain_contribute` and
  `brain_submit`. The tool stays in the list (the
  [MCP tools](mcp-tools.md) surface does not flicker per brain); the
  refusal carries the redirect.

Everything read-shaped — search, read, neighbors, overview — is untouched,
and `brain_overview` notes which brains are mirrors so an agent learns the
rule before tripping on it.

## Your notes: the cortex overlay

Complementing knowledge never belongs in the mirror. It goes to your own
brain — the cortex, or a project brain — as a normal page that *links* to the
implant's page with a `brain://` address
([brain subsidiarity](brain-subsidiarity.md)). Reading the implant's page
then shows the connection from the other side: `brain_read` returns an
`annotations` list naming every doc in every *other* mounted brain that
points at this one — your correction rides along whenever you re-read the
page it corrects, without the implant changing by a byte.

Misleading content in the implant itself is the upstream's problem to fix
and yours to report: that is
[contributing to an implant](contributing-to-an-implant.md).

The normative contract is `spec/105-contribute.md`, building on
[federation](federation.md) (spec/75) and the sync ladder in
[MCP tools](mcp-tools.md) (spec/100).
