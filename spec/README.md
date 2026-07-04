# The brainpick spec

This directory is the contract between brainpick implementations. The pip
and npm engines are independent programs; what makes them one product is
that both produce and consume the formats defined here, proven by the shared
fixtures and conformance cases.

## Normative vs advisory

- **Normative** artifacts and behaviors are conformance-tested. Two engines
  compiling the same bundle MUST produce byte-identical normative artifacts
  (after normalizing the volatile fields each spec section names).
- **Advisory** artifacts are schema-described but implementation-defined in
  content (layouts, timelines, caches). Consumers MUST tolerate their
  absence.

## Case classes and partial engines

An engine that does not yet implement a conformance case class MUST skip
those cases VISIBLY (a skip in its test output, never a silent pass) — CI
watches skip counts. A class an engine claims (its tier is implemented) is
never skipped.

## Change process

Spec-first: a behavior change lands as a spec edit plus a new or updated
conformance case/fixture FIRST, then the implementations follow. Golden
files are regenerated only via `scripts/regen-golden.py` (the Python engine
is the reference implementation) and the diffs are reviewed like code.

## Sections

| File | Contents |
|------|----------|
| `00-overview.md` | tiers, disposability, degradation |
| `10-manifest.md` | `manifest.json`, hashing, canonicalization rules |
| `20-t1-artifacts.md` | `graph.json`, `docs.jsonl`, generated `index.md` |
| `30-t2-vectors.md` | chunker, `chunks.jsonl`, embedding record, LanceDB layout, mock embedder |
| `40-t3-kg.md` | the neutral entity/relation export, id normalization, graph retrieval |
| `50-rest-api.md` | the REST surface both servers implement |
| `60-live-deltas.md` | the SSE delta protocol |
| `70-mcp-tools.md` | MCP tool names, schemas, budgets |
| `80-config.md` | `brainpick.toml` |
| `schemas/` | JSON Schemas for normative artifacts and messages |
| `fixtures/` | bundles + golden expected artifacts + delta scenarios |
| `conformance/cases.yaml` | the language-agnostic case list |

Version: **0.1** (pre-release; breaking changes allowed until 1.0).
