# brainpick (Node engine)

**A turn-key brain stack for agents — with zero Python.** Compile a folder of
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
markdown into a queryable, servable, visualizable brain, then serve it to
agents over MCP + CLI and to humans through a live holographic-brain web UI.

This native Node engine produces **byte-identical artifacts** to the
[Python engine](https://pypi.org/project/brainpick/) — proven by a shared
conformance suite — so a brain compiled by one is served and queried by the
other. The npm package contains no Python and never shells out to any.

```bash
npx brainpick init --root ./my-okf-bundle   # detect, configure, compile
npx brainpick serve --open                  # the living graph, zero API keys
```

## The tiers

| Tier | What | Needs |
|------|------|-------|
| T0 | grep/glob over the files | nothing |
| T1 | generated `index.md`, link graph, backlinks, tags | nothing (deterministic) |
| T2 | vector search over chunks | an embedding model |
| T3 | entity/relation graph | a small LLM |

Vector search uses `@lancedb/lancedb` (an optional dependency — its absence
degrades T2 with an instruction, never breaks T1). Entity extraction (T3
compile) is Python-anchored; the Node engine delegates that one step to an
installed Python sibling or skips it, while querying the resulting graph
natively.

The markdown is the only source of truth; everything under `.brainpick/` is a
disposable build artifact. See the
[full README, principles, and docs](https://github.com/benquemax/brainpick).

MIT.
