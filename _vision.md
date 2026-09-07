# Brainpick — vision

*A turn-key brain stack for agents: plain markdown in, a living brain out.*

## The gap

OKF gives agent knowledge a shape — concept docs, frontmatter, links.
henxels holds every writer, human or model, to that shape. But between
"a folder of valid markdown" and "a brain an agent can actually pick"
there is a missing layer: indexes nobody should maintain by hand,
embeddings, entity graphs, servers, and a way for humans to *see* the
thing. Brainpick is that layer.

## What Brainpick is

Brainpick compiles an OKF bundle into a queryable brain and serves it
to everyone who needs it:

- **Agents** get MCP (stdio, SSE, streamable HTTP) and CLI tools: one
  search that multiplexes keyword, semantic, and graph strategies;
  read; neighbors; overview; and guarded writes that pass through the
  henxels contract before they touch disk.
- **Humans** get the movie scene: the knowledge rendered as a floating
  holographic brain — clusters arranged into lobes, edges firing as
  agents write, spun and pinched with your fingers, on your desktop or
  your phone (installable PWA, touch-first). One gesture morphs it
  into a flat GPU cosmos for analytic work: semantic zoom, search-as-
  flight, a time scrubber over the brain's history. It updates live —
  never a page refresh.
- **Operators** get one compile pipeline — incremental, cron-able,
  watchable — and one `serve` process per runtime.

## The tiers

| Tier | What | Needs |
|------|------|-------|
| T0 | grep/glob over the files | nothing |
| T1 | generated `index.md`, link graph, backlinks, tags | nothing (deterministic) |
| T2 | vector search over chunks | an embedding model |
| T3 | entity/relation graph (ghosts, tags, co-occurrence) | nothing — derived from links and tags |

T1 is always on and rebuilds in under a second. T2 and T3 are optional
modules; every tier degrades gracefully to the one below. The
visualization runs from T1 up — no API key required for the first wow.

## One spec, two native runtimes

Everything under `.brainpick/` is a documented, runtime-neutral
artifact spec, verified by shared conformance fixtures. `pip install
brainpick` gets the full compiler and server in Python; `npm install
brainpick` gets a native Node server and compiler with zero Python
required — same artifacts, same web UI, same MCP tools, every tier
compiled natively in both.

## The hypothesis

Give an agent powered by a small model frictionless access to knowledge
and skills that evolve in real time, and you get a self-improving agent
that is not only as capable as one on a large, powerful LLM but better —
if the large LLM does not have the same frictionless, evolving access.
Brainpick therefore aims at an architecture in which the agent has
*sufficient* intelligence inside the LLM and the skills plus knowledge
are not baked into it. That decreases the need for huge amounts of VRAM
and compute, has the potential for a better and more up-to-date world
understanding than big LLMs, and produces more intelligence per kWh.
The brain format's data flow — journals distil into knowledge into
skills, every write refereed, every claim grounded — is how the outside
memory earns the trust a model would otherwise need weights for. The bet
is testable, and testing it (same tasks, small model with a brain against
large model without, in outcomes and watt-hours) is on the roadmap.

A sub-hypothesis: a knowledge graph only contributes to the evolution of
a brain if it can be rebuilt on every commit. Knowledge accumulates in
the repository; the graph is generated from it, algorithmically, in
under a second — so it is never behind the brain. The widely used
alternative, an LLM-extracted graph such as LightRAG, is rebuilt from
scratch once in a while because it is expensive; it is outdated from
day one, and because the model re-derives everything from zero it never
credits what the brain already knew — such graphs do not contribute to
evolution. We tried it, and removed it. Brainpick is reinventing the
knowledge graph on this premise: associations live in the files, where
agents improve them, and the graph is what the files say today.

## Who it is for

Small local models are first-class citizens: the target profile is a
qwen3.6-class 27B running on your own machine. Everything — tool
count, schemas, result sizes, extraction prompts — is designed for
that profile first. Frontier models just go faster. And it is
agent-agnostic: any harness that speaks MCP, a shell, or plain files
is a full citizen.

## How it is built

Test-driven, spec-first, and self-hosted: this repo is governed by
henxels, its docs are codumented (validated against the code they
describe), and both engines must pass the same conformance fixtures.
The documentation itself is an OKF brain in `docs/` — the first brain
brainpick ever compiles is the one that explains it. Perfect UX and AX
are fruits of great DX.

## What v1 includes

The full stack: compile (T1–T3), MCP + CLI, guarded writes, the
holographic brain + cosmos UI as an installable live PWA, magic
onboarding (`uvx brainpick init` / `npx brainpick init` — into an
existing brain or a fresh one via henxels' OKF template), native
packages on PyPI and npm.

## Non-goals

Brainpick is **not** a format (that's OKF), **not** a linter (that's
henxels), **not** a note-taking app (bring your editor), and **not**
an agent framework (bring your agent).

## Siblings

[henxels](https://github.com/benquemax/henxels) — suspenders for your
repo: Brainpick assumes a henxels-governed bundle and delegates all
format enforcement to it. Brainpick generates, henxels verifies.
[codumentation](https://github.com/benquemax/codumentation) — keeps
Brainpick's own documentation provably true.
