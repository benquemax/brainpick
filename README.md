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

**A turn-key brain stack for agents.** Knowledge lives as an
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle of plain markdown, [henxels](https://github.com/benquemax/henxels)
keeps every writer true to the format, and brainpick compiles the bundle into
tiered, disposable artifacts — a generated index, a link graph, vectors, an
entity graph — then serves them to agents (MCP + CLI) and to humans (a
holographic-brain web UI that updates live while agents write).


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
| T3 | entity/relation graph (ghosts, tags, co-occurrence) | nothing by default; a small LLM for richer extraction |


## Quick start

### 1 · Install the app and see a brain immediately

The fastest path is the desktop app — a single file that runs the brainpick
service and shows the holographic brain. Grab the installer for your OS from
the [latest release](https://github.com/benquemax/brainpick/releases):

- **Linux** — `Brainpick_*.AppImage` (`chmod +x`, then run; needs system
  `webkit2gtk-4.1`, the standard Tauri Linux prerequisite).
- **macOS** — `Brainpick_*.dmg` (Apple Silicon; first launch: right-click →
  Open, since the build is unsigned).
- **Windows** — `Brainpick_*.msi` (SmartScreen → More info → Run anyway).

On first launch it seeds a **demo brain** — this repository's own docs wiki,
cloned from GitHub — so you land on a real, link-rich, spinnable brain with
zero setup. Remove it any time; it never comes back.

> Prefer the terminal, a NAS, or a scriptable setup? The same service runs
> headless as `brainpickd start` (each brain serves its own port; other
> machines need only a browser). Set `BRAINPICK_NO_DEMO=1` to skip the demo
> seed.

### 2 · Start a brand-new brain (empty GitHub repo + henxels)

[henxels](https://github.com/benquemax/henxels) scaffolds a governed OKF wiki
and installs the contract that keeps every future write true to the format:

```bash
# create an empty repo on GitHub, then:
git clone git@github.com:you/my-brain.git && cd my-brain
henxels init --template okf-llm-wiki --wiki-dir docs   # scaffold + govern docs/
git add -A && git commit -m "scaffold brain" && git push
```

Now **Add a brain** in the app (paste the repo URL — a public repo clones as
is; a private one gets a one-click deploy key), or point a bare engine at it:
`brainpick serve --root docs --open`.

### 3 · Migrate an existing repo (henxels does the driving)

Any folder of markdown can become a governed brain. `henxels` installs the
contract and its `check` output *is* your migration checklist — instructive,
one fix at a time:

```bash
cd your-existing-repo
henxels init                 # install the contract
henxels check --all          # the fix-list = exactly what to fix, and why
# work the list until it is green (an agent can do this — see below)
brainpick serve --root docs --open
```

Don't want to work the list by hand? Add the folder in the app anyway: for a
not-yet-OKF bundle the wizard hands you a **paste-ready prompt** that steers
your coding agent to make it Brainpick-compatible.

### Running the engines from a checkout

The `brainpick` pip/npm packages are not published yet, but both engines
already work from a clone — Python (the reference) and native Node, no Python
required:

```bash
cd packages/python && uv run brainpick serve --root ../../docs --open   # Python
npm run build -w packages/node && node packages/node/dist/cli.js serve --root docs --open   # Node
```

Once they publish, first contact collapses to `uvx brainpick serve --open`
(or `npx brainpick serve` — pip and npm are native peers).


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


