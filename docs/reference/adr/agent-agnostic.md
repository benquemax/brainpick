---
type: decision
about: concept
title: "ADR: agent-agnostic, AGENTS.md is the one agent doc"
description: "Why brainpick plays no favorites among harnesses — MCP, CLI and plain files serve any agent — and keeps one agent-facing document, AGENTS.md, with CLAUDE.md as a thin wrapper."
tags: [agents, governance]
timestamp: 2026-07-10T18:30:00Z
---

# ADR: agent-agnostic, AGENTS.md is the one agent doc

**Context.** Agents run in many harnesses — Claude Code, OpenCode, Aider and more
— and per-harness documentation multiplies and drifts as each one keeps its own
copy of the same guidance.

**Decision.** Be agent-agnostic by birth: expose MCP, CLI and plain files that
favor no harness, and keep exactly one agent-facing document, `AGENTS.md`, with
`CLAUDE.md` reduced to `@AGENTS.md`. Integrations install the shipped skill
additively per harness without editing settings for the user — the story of
[Agent integrations](../../agent-integrations.md).

**Alternatives considered.** Maintain a document per harness (CLAUDE.md,
per-tool rules files) each by hand. Rejected — parallel docs diverge, and coupling
the product to any one format, linter or agent framework would betray the agnostic
stance.

**Consequences.** One document to keep true, one skill shipped byte-identically
into both engines by [brainpick integrate](../cli/integrate.md), and a
graph-before-grep brain report any harness can read. The same [MCP tools](../../mcp-tools.md)
are mirrored as verbs in the [CLI reference](../../reference-cli.md), and
[brain_overview](../mcp/brain-overview.md) orients any agent regardless of harness,
under the [Wiki conventions](../../wiki-conventions.md). Back to
[Architecture decision records](../../reference-adr.md).
