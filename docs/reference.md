---
type: Reference
title: "Reference"
description: "The source-derivable reference for brainpick — every CLI command, config key, spec contract, MCP tool and henxels rule, one page each, richly cross-linked, plus the decision volume."
timestamp: 2026-07-08T12:00:00Z
---

# Reference

This is brainpick's **reference volume**: the enumerable, source-derived
surface of the whole stack, split into five categories, each a hub of concise
one-per-item pages. Where the concept docs explain *why*, the reference pages
pin down *exactly what* — the real flags, keys, contracts and rules, derived
from the code and the spec, never invented.

## The categories

- [CLI reference](reference-cli.md) — every `brainpick` subcommand and its flags.
- [Configuration reference](reference-config.md) — every `brainpick.toml` key and its default.
- [Spec reference](reference-spec.md) — the normative contracts both engines honor.
- [MCP tool reference](reference-mcp.md) — the six agent-facing tools, one page each.
- [Henxels contract reference](reference-henxels.md) — each rule and behaviour in `henxels.yaml`.

## What it complements

The reference sits alongside the concept docs it enumerates: it grounds
[the tiers](the-tiers.md) in concrete artifacts, the [compile pipeline](compile-pipeline.md)
in concrete commands, and the [artifact spec](artifact-spec.md) in concrete
files. It is also the deep end of the [agent integrations](agent-integrations.md)
story — the pages an agent reads after `brain_overview` — and it follows the
[wiki conventions](wiki-conventions.md) it documents, so this corpus is both
the reference and a stress test of the interface at scale.

## The decisions

Alongside the enumerable reference sits the decision volume:
[Architecture decision records](reference-adr.md) — one ADR per founding or major
call, each with its context, the alternatives weighed and the consequences. Where
these category pages pin down *what*, the ADRs record *why brainpick chose it*.
