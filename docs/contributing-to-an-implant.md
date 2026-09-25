---
type: playbook
about: process
title: Contributing to an implant
description: "brain_contribute writes and commits a proposed change in a separate working copy (a git worktree, branch contrib/<name>) after passing the target brain's own contract; brain_submit sends it upstream as a pull request — forge CLI, fork remote, or a patch file — never touching the original repository."
tags: [agents, mcp, brain, spec]
timestamp: 2026-09-25T16:00:00Z
---

# Contributing to an implant

You mounted a [read-only implant](read-only-implants.md), found a page that
is wrong, and you cannot push (publish commits) to it. The honest move is
the open-source one: propose the fix to the people who own the brain, as a
pull request (a change offered for the maintainers to review and take).
Two verbs make that a first-class flow instead of a shell excursion.

## brain_contribute: stage the change

`brain_contribute({doc, content, message, brain?, mode?, base_sha?,
proposal?})` takes exactly [brain_write](reference/mcp/brain-write.md)'s
arguments plus a commit message — under [federation](federation.md) the
`brain` argument names which mounted brain the proposal targets — and:

1. fetches, and branches `contrib/<name>` from origin's newest default
   branch — the proposal starts from what upstream has *now*, not from
   your possibly-stale mirror;
2. checks that branch out in a **git worktree** — a second working copy of
   the same repository in a separate folder (under
   `~/.local/share/brainpick/proposals/`), sharing its history and hooks —
   so the served checkout, the mirror agents read from, is never touched;
3. runs the write through the same ladder as
   [guarded writes](guarded-writes.md), against the **target brain's own
   henxels contract** — a proposal that would fail upstream's rules is
   refused here, not after review;
4. compiles and commits (hooks always run, as in the push rules of
   [MCP tools](mcp-tools.md)).

The result names the `proposal` (branch, commits, files, `stale_base` when
upstream moved since you branched — reported, never rebased) and
`read_first`: the implant's own contribution rules, from `[brain]
contributing` in its config, else `CONTRIBUTING.md`, else its conventions
index. First contact is **apply and brief** — the write is accepted *and*
you are pointed at the house rules, because refusing a good fix to enforce
a reading list helps nobody. Several calls with the same `proposal` name
stack commits on one branch; `drop: true` removes a proposal, and nothing
is ever dropped automatically.

## brain_submit: send it upstream

`brain_submit({proposal, brain?, title?, body?})` climbs a ladder of what
the machine actually has, and **never pushes to origin** (the original
repository) — only to your own copy of it (your fork):

1. **forge-cli** — `gh` (GitHub) or `tea` (Gitea) on PATH and logged in:
   fork once, push the branch to the fork, open the pull request; returns
   `pr_url`.
2. **fork-remote** — a git remote named `fork`: push the branch there and
   return a `compare_url` to open in a browser.
3. **patch** — always works, needs no account: `git format-patch` writes
   the proposal as a patch file to attach to an issue or send to the
   maintainers.

The title and body are drafted from data the engine has — your commit
messages, the touched pages, and a **Checks** block stating that the
implant's own contract passed locally. Which rung ran is recorded in the
proposal itself, so it survives a restart.

## Lifecycle

`brain_status` lists open proposals with `merged` (upstream took it —
drop it and `brain_sync` brings it back the official way) and `submitted`.
The three verbs sit on the `[serve] git` ladder from
[MCP tools](mcp-tools.md) as `off | status | sync | contribute | push` —
contribute below push, because nothing on this path can write a repository
you do not own.

The normative contract is `spec/105-contribute.md`.
