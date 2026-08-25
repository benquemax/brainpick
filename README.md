<!-- markdownlint-disable -->
```
   ╭────────────────────╮
   │      ●───●         │
   │     ╱ ╲ ╱ ╲        │   b r a i n p i c k
   │    ●───●───●       │   pick your agent's brain
   │     ╲ ╱ ╲ ╱ ⛏      │   plain markdown in · a living brain out
   │      ●───●         │
   ╰────────────────────╯
```
<!-- markdownlint-enable -->

# brainpick

**A turn-key brain stack for AI agents — plain markdown in, a living
knowledge graph out.** Your agents' knowledge lives as an
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle of plain markdown files — [henxels](https://github.com/benquemax/henxels)
keeps every writer true to the format — and brainpick compiles it into
tiered, disposable artifacts: a generated index, a link graph, semantic
vectors, an entity graph. Agents consume the compiled brain over
[MCP](https://modelcontextprotocol.io) and the CLI; everything is
local-first, deterministic wherever a model isn't needed, and no server is
ever required.

Humans get a separate, optional face: the **holographic brain**, a web UI
that renders the same compiled graph and updates live while agents write.
It is a window into the brain, never a dependency of it — see the
[live demo](https://benquemax.github.io/brainpick/), this repository's own
docs compiled and served by brainpick itself.


## Principles

1. **Small models are first-class citizens.** If a 27B can't drive it, it
   doesn't ship — few tools, obvious names, forgiving inputs, token-budgeted
   outputs.
2. **The files are the brain.** Markdown + frontmatter is the only source of
   truth; everything compiled is disposable. `rm -rf .brainpick/` loses
   nothing.
3. **Deterministic before generative.** Whatever can be computed without a
   model is computed without a model; LLM layers enrich — they never
   gatekeep.
4. **Agents never tend the index.** Derived state is compiled from
   frontmatter, never hand-maintained. The agent's job is knowledge;
   brainpick's job is bookkeeping.
5. **Every layer is optional except the files.** grep → links → vectors →
   entities: each tier upgrades retrieval, none is load-bearing, every tier
   degrades gracefully to the one below.
6. **One brain, two faces.** Agents and humans consume the same compiled
   truth — the hologram you spin is the graph the agent walks. On every
   screen, installable as a PWA, updated live — never refreshed.
7. **Writes go through the suspenders.** Nothing enters the brain
   unvalidated: henxels referees every write, from a git hook or from
   `brain_write` alike. Brainpick generates, henxels verifies.
8. **One spec, many runtimes.** The compiled brain is a documented,
   runtime-neutral format; pip and npm are native peers (no Python required
   of Node users) kept honest by shared conformance fixtures.
9. **Agent-agnostic by birth.** MCP, CLI, and plain files play no favorites
   among harnesses. In this repo, AGENTS.md is the one agent-facing
   document; CLAUDE.md is just `@AGENTS.md`.
10. **Onboarding is magic, not a manual.** One command from zero to a living
    brain: detect, propose, compile, glow. No API key for the first wow.
11. **Local-first, spec-true.** Offline is a first-class deployment; cloud
    is a convenience. Stay OKF-compliant; push conventions upstream, never
    fork.
12. **Perfect UX and AX are fruits of great DX.** The artifact spec, TDD,
    conformance fixtures, the henxels contract, and codumented docs are how
    the agent- and human-facing surfaces stay perfect.
13. **The family eats its own dog food.** This repo is governed by henxels
    and codumented from day one, and every feature is exercised on a real
    brain — bugs in any sibling tool surface at home first.


## The tiers

| Tier | What | Needs |
|------|------|-------|
| T0 | grep/glob over the files | nothing |
| T1 | generated `index.md`, link graph, backlinks, tags | nothing (deterministic) |
| T2 | vector search over chunks | an embedding model |
| T3 | entity/relation graph (ghosts, tags, co-occurrence) | nothing — derived from links and tags |


## Quick start

### Give your agent a brain — paste one prompt

Agentic setup is the primary path: your coding agent installs brainpick,
compiles the brain, and wires itself to it. Paste this to the agent:

> Install brainpick (`uv tool install brainpick`, or `pipx install
> brainpick`, or `npm i -g brainpick` — pip and npm are native peers; the
> npm one never needs Python). In the repo that holds (or should hold) the
> markdown knowledge base, run `brainpick init` — it detects the bundle
> (offering henxels' `okf-llm-wiki` scaffold if the folder is empty),
> detects an embedding backend if one is reachable, writes the config, and
> compiles tier 1. Then run `brainpick integrate claude-code` (or
> `opencode`, or `agents-md`) to install the Agent Skill and print the
> MCP snippet — wire it into the harness config. From then on, consult the
> brain before grepping: `brain_overview` first, then `brain_search`,
> `brain_read`, `brain_neighbors`. Finally commit the bundle and the
> brainpick config.

No server appears anywhere in that flow: agents talk to `brainpick mcp`
over stdio, spawned on demand by the harness itself. The read tools also
exist as plain CLI verbs (`brainpick search` · `read` · `neighbors` ·
`overview`) for shells, scripts, and CI.

### Manual install

The same journey by hand:

```bash
uv tool install brainpick        # or: pipx install brainpick · npm i -g brainpick
brainpick init                   # detect bundle + backends, write config, compile T1
brainpick integrate claude-code  # Agent Skill + the MCP wiring snippet
brainpick search "anything"      # the brain answers from the terminal
```

One-shot flavors work too: `uvx brainpick init` / `npx brainpick init`.

### No wiki yet, or a messy one? henxels drives

A brand-new brain — [henxels](https://github.com/benquemax/henxels)
scaffolds a governed OKF wiki and installs the contract that keeps every
future write true to the format:

```bash
henxels init --template okf-llm-wiki --wiki-dir docs   # scaffold + govern docs/
```

An existing folder of markdown: `henxels init` installs the contract and
`henxels check --all` prints your migration checklist — instructive, one
fix at a time, and an agent can work the list.

### The GUI — see what your agent sees (optional)

Everything above is the whole product as far as agents are concerned. The
GUI is for the humans: the **holographic brain** — search, spin, and
time-travel the same compiled graph the agents walk, updating live with
every write. Nice to have, never required.

- **Zero install** — the [live demo](https://benquemax.github.io/brainpick/)
  is this repo's own docs wiki, baked into a static snapshot and redeployed
  with every release: the real UI, searchable, with the full time machine,
  served by GitHub Pages with no engine behind it.
- **One command** — `brainpick serve --root docs --open` opens the UI over
  any compiled brain.
- **The desktop app** — grab an installer from the
  [latest release](https://github.com/benquemax/brainpick/releases): Linux
  `Brainpick_*.AppImage` (`chmod +x`, needs system `webkit2gtk-4.1`),
  macOS `Brainpick_*.dmg` (right-click → Open; the build is unsigned),
  Windows `Brainpick_*.msi` (SmartScreen → More info → Run anyway). First
  launch seeds a **demo brain** — remove it any time; it never comes back.
  **Add a brain** takes a repo URL or a local folder, and for a not-yet-OKF
  folder hands you a paste-ready prompt for your coding agent. Prefer a
  terminal or a NAS? The same service runs headless as `brainpickd start`;
  `BRAINPICK_NO_DEMO=1` skips the demo seed.

### Until v0.1 ships: run from a checkout

The `brainpick` pip/npm packages are not published yet; both engines
already work from a clone — Python (the reference) and native Node, no
Python required:

```bash
cd packages/python && uv run brainpick serve --root ../../docs --open   # Python
npm run build -w packages/node && node packages/node/dist/cli.js serve --root docs --open   # Node
```

Once they publish, first contact collapses to the prompt above — or
`uvx brainpick init` / `npx brainpick init` by hand.


## Status

**Early.** The full stack is built and the desktop app is downloadable from
[Releases](https://github.com/benquemax/brainpick/releases) for early testers.
The vision is committed in
[`_vision.md`](https://github.com/benquemax/brainpick/blob/main/_vision.md);
the milestones (Ensilento → Kaksoisveto → Hologrammi) landed. The `brainpick`
pip and npm packages are not published yet — the names are reserved for the
v0.1 release.


## Siblings

- [henxels](https://github.com/benquemax/henxels) — suspenders for your
  repo; the referee for every write brainpick compiles.
- [codumentation](https://github.com/benquemax/codumentation) — keeps this
  repository's documentation provably true.


## License

MIT.


