import * as fs from 'fs';
import * as path from 'path';

export const content = `## How parity is proven

Claims here are not promises — they are checked. The shared
\`spec/conformance/cases.yaml\` runs in both engines' test suites with zero
skips of a claimed case class; a pinned cross-engine scrypt vector makes auth
hashes identical byte-for-byte; and the LanceDB dataset one engine writes is
read by the other in a live interop test. This very page is codumented — its
matrix claims (identical CLIs, no Python in the npm package, LanceDB kept
optional, the Node merge resolver present) are validated on every push, so the
doc cannot quietly drift from the code.
`;

export const validate = async () => {
  const repo = path.join(__dirname, '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf-8');

  // Claim: the shared conformance cases run in both engines with zero skips of a claimed class.
  const cases = read('spec/conformance/cases.yaml');
  const classes = new Set([...cases.matchAll(/^\s+class:\s*([a-z-]+)/gm)].map((m) => m[1]));
  if (classes.size === 0) throw new Error('no case classes found in cases.yaml — the parity proof is empty');
  for (const [engine, harness] of [
    ['python', 'packages/python/tests/test_conformance.py'],
    ['node', 'packages/node/test/conformance.test.ts'],
  ] as const) {
    const src = read(harness);
    if (/\.skip\(|test\.skip|it\.skip|@pytest\.mark\.skip/.test(src)) {
      throw new Error(`${engine} conformance harness contains a skip — a claimed class must never be skipped`);
    }
    for (const cls of classes) {
      if (!src.includes(cls)) {
        throw new Error(`${engine} conformance harness does not implement the "${cls}" case class`);
      }
    }
  }

  // Claim: a pinned cross-engine scrypt vector exists in BOTH auth test suites.
  const pyAuth = read('packages/python/tests/test_auth.py');
  const nodeAuth = read('packages/node/test/auth.test.ts');
  const vector = /80608aa957eedae8f1b922e3bf1ed3ede04db92345065a02ea4cf7081d2ece06/;
  if (!vector.test(pyAuth) || !vector.test(nodeAuth)) {
    throw new Error('the pinned cross-engine scrypt vector is missing from an auth suite — hash parity is unproven');
  }
};

export const errorContent = `
[Validation Failed] The "How parity is proven" section drifted.

This section claims the conformance suite runs skip-free in both engines and
that a pinned scrypt vector proves hash parity. If a harness gained a skip or
the vector moved, the claim is now false — fix the suite, or update the prose
in docs/runtime-parity.md.codx/howParityIsProven.ts.
`;
