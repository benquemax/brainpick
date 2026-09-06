---
type: article
about: concept
title: Federation
description: Many brains behind one MCP server — an agent asks once and every registered brain answers, hits merged and paths qualified as alias:path, so a project's knowledge and your personal brain are one search away.
tags: [agents, mcp, spec]
timestamp: 2026-09-06T11:30:00Z
---

# Federation

An agent rarely lives in one brain. It works inside a project (that project's
bundle), it carries the user around (a personal brain), and it may need two
sibling projects' notes to answer "how did we do video generation last time?".
Before federation each of those was its own `brainpick mcp --root DIR` entry in
the agent host — one process per brain, the target baked into the host's
config, and the agent choosing which server to ask before it knew which one
held the answer. Federation flips that: **one server fronts many brains**, and
the agent asks once.

## The brain set

`brainpick mcp` without `--root` assembles a *brain set* from two sources
(spec/75, [Spec: federation](reference/spec/federation.md)):

- **The registry** — the same `~/.config/brainpick/brains.toml` that
  [the daemon](daemon.md) keeps. [brainpick register](reference/cli/register.md)
  adds a bundle to it once; `--user` marks your personal brain (the `me`
  scope). Federation reads the registry and never clones a remote entry — a
  remote brain only takes part once the daemon has cloned it.
- **Here** — the bundle the working directory sits in (found by walking up to
  a `brainpick.toml` or a `.brainpick/`). It joins the set even if it was never
  registered, and it is where an unqualified `brain_write` lands.

Explicit `--root` flags still win outright — `brainpick mcp --root a --root
me=b` fronts exactly those two (an `ALIAS=` prefix names one) — and a set of
one brain serves the plain single-brain payloads it always did. Federation is
only *on* when more than one brain is present, so nothing changes for the
one-brain setups already deployed.

Brains load lazily: each compiles-if-stale and loads on its first use, so a
registry of twenty projects costs nothing until a query actually reaches them.

## Addressing: alias:path

Every brain has an **alias** — its git repo name by default, the directory name
outside a repo, `--alias` to choose one — and every path an agent sees from a
federated server is qualified: `acme:docs/video-gen.md`. Tools accept it back:
`brain_read 'acme:docs/video-gen.md'`. An unqualified doc is resolved in every
brain; one hit is a hit, several become a disambiguation listing qualified
paths, none is a miss with qualified suggestions. Reserved words `all`, `here`,
`me` can never be aliases, and collisions take `-2`, `-3` in set order.

## What the agent sees

- **`brain_overview`** gains a `brains` list — alias, role, whether it is
  *here*, its root, doc count and tier status — that survives any budget. The
  tree shows the *focus* brain (here, else the first), and `scope` picks
  another.
- **`brain_search`** fans out to every brain in scope, merges the hits by
  score, qualifies the paths and tags each hit with its `brain`; the answer
  also carries `searched` and `contributing`. `scope` narrows it: `all`
  (default), `here`, `me`, or a comma-separated alias list — forgiving, like
  every enum in [MCP tools](mcp-tools.md).
- **`brain_read`**, **`brain_neighbors`** route by the qualified path (or the
  resolution ladder above) and answer with a `brain` field.
- **`brain_write`** never guesses: an unqualified target writes *here*; without
  a *here* it declines with an instruction naming the aliases.
- **`brain_show`** spotlights one brain per presentation — the first resolved
  node's — and lists the other brains' nodes as dropped.

The server's instructions name the brains and explain `alias:path`, so an agent
knows the shape before its first call. Both engines implement this identically;
the `federated-query` conformance class ([runtime parity](runtime-parity.md)) proves the merged hit
set agrees across a two-brain fixture.

## One entry, every brain

The onboarding snippets from [brainpick init](reference/cli/init.md) and
[brainpick integrate](reference/cli/integrate.md) now teach the shape this
enables — one user-scope MCP entry instead of one per project:

```
brainpick register ~/Git/acme            # this project
brainpick register ~/brain --user        # your personal brain
claude mcp add brainpick --scope user -- brainpick mcp
```

Whatever directory the agent starts in becomes *here*; everything registered
rides along. See [agent integrations](agent-integrations.md) for the harnesses
this plugs into and [the daemon](daemon.md) for the registry it shares.
