---
type: reference
about: thing
title: "brain_overview"
description: "The orientation tool — bundle name, counts, tier availability, the skills and the index tree — the progressive-disclosure root, with no required arguments."
tags: [mcp, agents]
timestamp: 2026-09-12T16:40:00Z
---

# brain_overview

`brain_overview()` takes no required arguments. It returns orientation: the
bundle name, `counts` (docs, edges, tags, orphans, ghosts), `tiers`, and a
`tree` of the index grouped with one-sentence descriptions, plus a `hint`.
Before the tree comes `skills` — every `type: skill`/`playbook` doc as
`{path, title, description, depends_on, tools}`, an empty list in a wiki —
trimmed only after the tree is empty, so the procedures the brain already
holds are the first thing an agent sees ([Skills](../../skills.md)).
Default budget 800 tokens. It is the progressive-disclosure root — the call an
agent makes first, before searching or reading.

Behind a federated server ([federation](../../federation.md)) it also returns
`brains` — `{alias, role, here, root, docs, tiers}` per brain, never trimmed —
and `scope` picks which brain's tree is shown (default: *here*, else the
first); its paths are then `alias:path`.

Its CLI mirror is [brainpick overview](../cli/overview.md); the counts and
tiers it reports are [the tiers](../../the-tiers.md), and the whole set is
[MCP tools](../../mcp-tools.md). Back to [MCP tool reference](../../reference-mcp.md).
