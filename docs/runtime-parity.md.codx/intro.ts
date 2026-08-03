import * as fs from 'fs';
import * as path from 'path';

export const content = `---
type: reference
about: concept
title: Runtime parity
description: What the pip and npm packages each do natively — the capability matrix that keeps "one spec, two engines" honest, and how the claims are proven.
tags: [engine]
timestamp: 2026-08-03T00:00:00Z
---

# Runtime parity

\`pip install brainpick\` and \`npm install brainpick\` are native peers: the npm
package contains no Python and never shells out to any. Parity is defined by
the [artifact spec](artifact-spec.md) and proven by the shared conformance
fixtures both engines must pass — see [the tiers](the-tiers.md) for the
capability ladder these rows walk.

| Capability | pip | npm |
|-----------|-----|-----|
| T1 compile (graph, docs, generated index) | native | native |
| Watch + incremental recompile + [live deltas](live-deltas.md) | native | native |
| T2 compile (chunk, embed over HTTP, LanceDB write) | native | native |
| T2 in-process local embeddings (no endpoint) | native (fastembed) | steer to Ollama or sibling |
| T2 query (hybrid BM25 + vector fusion) | native | native |
| Serve: REST + web UI + live channel | native | native |
| MCP stdio + streamable HTTP (5 tools) | native | native |
| [Guarded writes](guarded-writes.md) + base_sha conflict detection | native | native |
| Stale-write merge proposal (three-way / LLM) | native | native |
| Auth: tokens, password, sessions | native | native |
| init / doctor / integrate / the skill / CLI query mirrors | native | native |
| T3 compile — entity derivation (algorithmic) | native | native |
| T3 query over the neutral export | M3 | M3 |

The remaining asymmetries are principled, not accidental — T2's in-process
local embedding path steers to each ecosystem's own native option rather than
forcing one runtime to shell out to the other. T3 used to be the other
asymmetric row (LLM extraction anchored to the Python ecosystem, with Node
delegating that one compile step to an installed Python sibling) until that
extraction path was removed entirely — see
[ADR: the similarity gap-detector](reference/adr/similarity-gap-detector.md);
the algorithmic backend that replaced it is pure computation, so it always ran
natively in both engines anyway, and now there is nothing left to delegate.
The merge-proposal resolver behind [guarded writes](guarded-writes.md) runs
natively in both engines: the Node engine returns the same three-way (and, with
a configured \`[models.extraction]\` model, LLM) merge proposal on a stale write,
byte-identical to Python's conflict response.
`;

export const validate = async () => {
  const repo = path.join(__dirname, '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf-8');

  // Claim: "identical CLIs". Parse the subcommand set from each engine's CLI and
  // assert equality — no hardcoded list, so new commands added to both keep passing.
  // Capture the leading command WORD only — commander embeds args in the string
  // (`.command("search <query>")`) while argparse does not (`add_parser("search")`).
  const pySub = new Set(
    [...read('packages/python/src/brainpick/cli.py').matchAll(/add_parser\("([a-z-]+)/g)].map((m) => m[1]),
  );
  const nodeSub = new Set(
    [...read('packages/node/src/cli.ts').matchAll(/\.command\("([a-z-]+)/g)].map((m) => m[1]),
  );
  const onlyPy = [...pySub].filter((c) => !nodeSub.has(c));
  const onlyNode = [...nodeSub].filter((c) => !pySub.has(c));
  if (onlyPy.length || onlyNode.length) {
    throw new Error(
      `CLI parity broken — pip-only: [${onlyPy}], npm-only: [${onlyNode}]. ` +
        `The matrix claims identical CLIs; add the missing command to the other engine or update the doc.`,
    );
  }

  // Claim: "the npm package contains no Python and never shells out to any."
  const nodePkg = JSON.parse(read('packages/node/package.json'));
  const allDeps = {
    ...nodePkg.dependencies,
    ...nodePkg.optionalDependencies,
    ...nodePkg.devDependencies,
  };
  for (const dep of Object.keys(allDeps)) {
    if (/python|pyodide/i.test(dep)) throw new Error(`npm package depends on "${dep}" — the no-Python claim is false`);
  }
  if (nodePkg.scripts?.postinstall && /python|uv|pip/.test(nodePkg.scripts.postinstall)) {
    throw new Error('npm postinstall invokes Python — the no-Python claim is false');
  }

  // Claim: LanceDB stays optional (npm optionalDependency; Python [vectors] extra, not core).
  if (!nodePkg.optionalDependencies?.['@lancedb/lancedb']) {
    throw new Error('the matrix expects @lancedb/lancedb as an npm optionalDependency (T2 degrades, never breaks T1)');
  }
  const pyproject = read('packages/python/pyproject.toml');
  const coreDeps = pyproject.split(/^\[project\.optional-dependencies\]/m)[0];
  if (/^\s*"lancedb/m.test(coreDeps)) {
    throw new Error('lancedb is a CORE python dep — the matrix keeps it in the [vectors] extra so T1 stays lean');
  }

  // Claim: the "Stale-write merge proposal" row now reads native/native. Assert
  // the Node merge resolver is present, so deleting it re-breaks the matrix (the
  // former self-expiring tripwire, inverted now that the resolver has landed).
  if (!fs.existsSync(path.join(repo, 'packages/node/src/merge.ts'))) {
    throw new Error(
      'packages/node/src/merge.ts is missing — the "Stale-write merge proposal" row claims npm ' +
        'parity (native). Restore the Node merge resolver, or update the row.',
    );
  }
};

export const errorContent = `
[Validation Failed] The runtime-parity matrix drifted from the code.

Every row is a checked claim: identical CLIs (parsed from both cli files),
no Python in the npm package, LanceDB kept optional, and the Node merge
resolver present. Fix the code to match the matrix, or update docs/runtime-parity.md.codx/intro.ts
and run \`npx codumentation build\`. A parity change is worth a human's eyes.
`;
