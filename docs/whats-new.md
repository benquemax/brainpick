---
type: article
about: concept
title: What's new notice
description: "A release ledger every package ships, diffed against the version that last compiled a brain and the brain's stamped format — what changed and what to do about it, surfaced where agents already look, offline and deterministic."
tags: [agents, engine, brain-format]
timestamp: 2026-09-13T12:30:00Z
---

# What's new notice

The [Update notice](update-notice.md) says a newer brainpick exists. This
one says **what changed and what to do about it** — for an agent that just
found itself running an engine it did not install, on a brain some earlier
version compiled. Nothing to fetch, nothing to read up: the facts arrive at
the moment of orientation, with the exact command to run.

## The release ledger

`spec/releases.yaml` is the canonical ledger: one entry per release, newest
first, each with its `version`, `date` (or `unreleased` for the head of a
dev checkout), the `brain_format` that release writes, a one-paragraph
`summary` and a list of `changes` — `kind` (`added` | `changed` | `fixed` |
`removed`), `area` (`brain`, `cli`, `mcp`, `search`, `config`, `compile`,
`webui`, `docs`), `text`, and where a release asks something of an agent an
`agent_action` ("Run `brainpick migrate --to 2`."). Every package ships it
byte-identical (`scripts/sync-releases.mjs`, a parity test in each engine),
so [brainpick whats-new](reference/cli/whats-new.md) and the notice below
work offline and say the same thing in both engines. The ledger is
maintained by hand, like the update log, at release time; a release whose
entry is missing fails the ledger test ([Spec: configuration](reference/spec/config.md)).

## The notice

A pure function of four things — the ledger, the running version, the
`generator.version` in the manifest the compile started from (the engine
that last compiled this brain) and the brain's `[brain] format` stamp — so
it is deterministic and conformance-tested (class `whats-new`). It has two
independent parts and is absent when neither applies:

- **Releases since:** the ledger versions above the last compiler's and up
  to the running one — `brainpick 0.4.0 → 0.5.0: 2 releases since this brain
  was last compiled — run brainpick whats-new --since 0.4.0`. It clears on
  its own: the compile that raised it rewrites the manifest with the running
  version, so the next compile has nothing to report. A first compile has
  nothing to have missed. An `unreleased` head is never a missed release.
- **Format behind:** the brain's stamp is below the newest `brain_format`
  the ledger declares for the running version (an `unreleased` head counts:
  the format a dev checkout declares is the one it writes) — `brain format 1
  → 2: run brainpick migrate --to 2`. It stays until
  [brainpick migrate](reference/cli/migrate.md) runs. A wiki that is not a
  brain (format 0) hears nothing.

It surfaces exactly where the update notice does: one `- What's new:` line
in the AGENTS.md brain report ([Agent integrations](agent-integrations.md)),
after the bundle root and any `Engine:` line, outside the conformance golden
and gone when nothing applies; a `whats_new` object in
[brain_overview](reference/mcp/brain-overview.md) whose `hint` leads with
`What's new — …`; and one `note: what's new — …` line from
[brainpick compile](reference/cli/compile.md). Advice, never a gate — the
engine keeps serving the brain it compiled — but advice with a command in
it, which is what turns a version bump from a thing an agent might discover
into a thing it does. The [Compile pipeline](compile-pipeline.md) is where
it rides along.
