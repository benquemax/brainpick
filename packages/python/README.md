# brainpick (Python engine)

**A turn-key brain stack for agents.** Compile a folder of
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
markdown into a queryable, servable, visualizable brain — then serve it to
agents over MCP + CLI and to humans through a live holographic-brain web UI.

This is the Python engine (the reference implementation). A byte-identical
[native Node engine](https://www.npmjs.com/package/brainpick) ships on npm with
no Python required — same artifacts, same UI, same MCP tools.

```bash
uvx brainpick init --root ./my-okf-bundle   # detect, configure, compile
uvx brainpick serve --open                  # the living graph, zero API keys
```

## The tiers

| Tier | What | Needs |
|------|------|-------|
| T0 | grep/glob over the files | nothing |
| T1 | generated `index.md`, link graph, backlinks, tags | nothing (deterministic) |
| T2 | vector search over chunks | an embedding model |
| T3 | entity/relation graph (LightRAG behind an adapter) | a small LLM |

Extras: `brainpick[vectors]` (LanceDB), `brainpick[vectors-local]`
(fastembed, offline), `brainpick[graph]` (LightRAG extraction), `brainpick[all]`.

The markdown is the only source of truth; everything under `.brainpick/` is a
disposable build artifact. Small local models (qwen3.6-class) are first-class
citizens. See the [full README, principles, and docs](https://github.com/benquemax/brainpick).

MIT.
