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
| `50-rest-api.md` | the REST surface both servers implement |
| `60-live-deltas.md` | the SSE delta protocol |
| `70-mcp-tools.md` | MCP tool names, schemas, budgets |
| `80-config.md` | `brainpick.toml` |
| `schemas/` | JSON Schemas for normative artifacts and messages |
| `fixtures/` | bundles + golden expected artifacts + delta scenarios |
| `conformance/cases.yaml` | the language-agnostic case list |

Version: **0.1** (pre-release; breaking changes allowed until 1.0).
