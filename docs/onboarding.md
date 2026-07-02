---
type: Concept
title: Onboarding
description: One command from zero to a living brain — init detects the bundle and the models, compiles instantly, and hands every agent its config snippet.
timestamp: 2026-07-02T00:00:00Z
---

# Onboarding

`uvx brainpick init` (or `npx brainpick init` — see
[runtime parity](runtime-parity.md)) is designed to feel like magic, which
in practice means: detect, propose, compile, glow — and never interrogate.

The choreography:

1. **Detect the bundle** — an `index.md` with `okf_version`, or a density
   scan for concept documents; link style (markdown vs wikilinks) is sniffed
   into configuration. An empty directory is offered henxels'
   `okf-llm-wiki` template instead — brainpick never re-implements the
   scaffolding its sibling already owns.
2. **Detect the environment** — the [embedding detection](embedding-detection.md)
   ladder, an extraction endpoint for the
   [knowledge graph tier](knowledge-graph-tier.md), and whether a henxels
   contract governs the bundle.
3. **Write the config and compile T1** — sub-second, deterministic, green at
   birth, with a stat line worth reading ("47 concepts · 132 links · 2
   orphans — your brain, compiled").
4. **Hand out the keys** — paste-able MCP snippets for the agents you
   actually run (matching how init itself was invoked), the henxels
   freshness-gate fragment if a contract exists, and an offer to open the
   [holographic brain](holographic-brain.md) with `brainpick serve --open`.

The first wow requires zero API keys: T1 plus the [live deltas](live-deltas.md)
channel already gives you a living graph. Models only make it deeper.
