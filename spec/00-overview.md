# Overview

Brainpick compiles an OKF bundle (a directory tree of markdown concept
documents with YAML frontmatter) into tiered, disposable artifacts under
`.brainpick/`, and serves them over REST, MCP, and a web UI.

## Tiers

| Tier | Artifacts | Needs |
|------|-----------|-------|
| T1 | `t1/graph.json`, `t1/docs.jsonl`, generated `index.md` (+ advisory layout/timeline) | nothing — deterministic |
| T2 | `t2/chunks.jsonl`, LanceDB dataset, `t2/embedding.json` | an embedding model |
| T3 | `t3/entities.jsonl`, `t3/relations.jsonl` | an extraction LLM |

T1 MUST be implemented by every engine and MUST NOT invoke any model.
T2/T3 are optional modules; an engine lacking one degrades to the tier
below and MUST say so in its responses (`degraded_from`).

Spec 0.1 normatively covers T1, the REST surface, the delta protocol, MCP
tools, and config. T2 (`30-t2-vectors.md`) landed with M2; T3
(`40-t3-kg.md`) lands with M3 — its neutral export is normative, its
extraction advisory.

## Disposability

Everything under `.brainpick/` is regenerable. `rm -rf .brainpick/` followed
by a compile MUST reconstruct byte-identical normative artifacts for an
unchanged bundle. Engines MUST NOT store the only copy of anything under
`.brainpick/`.

## The bundle

A bundle is a directory of `*.md` files. `index.md` and `log.md` are
reserved (OKF): they are scanned as documents (`reserved: true`) but carry
no frontmatter, except the bundle root `index.md`, which MAY declare
`okf_version`. Frontmatter parsing is tolerant: absent or unparseable
frontmatter yields an empty mapping, never an error.
