import * as fs from 'fs';
import * as path from 'path';

export const content = `## Principles

1. **Small models are first-class citizens.** If a 27B can't drive it, it
   doesn't ship — few tools, obvious names, forgiving inputs, token-budgeted
   outputs.
2. **The files are the brain.** Markdown + frontmatter is the only source of
   truth; everything compiled is disposable. \`rm -rf .brainpick/\` loses
   nothing.
3. **Deterministic before generative.** Whatever can be computed without a
   model is computed without a model; LLM layers enrich — they never
   gatekeep.
4. **Agents never tend the index.** Derived state is compiled from
   frontmatter, never hand-maintained. The agent's job is knowledge;
   brainpick's job is bookkeeping.
5. **Every layer is optional except the files.** grep → links → vectors →
   entities: each tier upgrades retrieval, none is load-bearing, every tier
   degrades gracefully to the one below.
6. **One brain, two faces.** Agents and humans consume the same compiled
   truth — the hologram you spin is the graph the agent walks. On every
   screen, installable as a PWA, updated live — never refreshed.
7. **Writes go through the suspenders.** Nothing enters the brain
   unvalidated: henxels referees every write, from a git hook or from
   \`brain_write\` alike. Brainpick generates, henxels verifies.
8. **One spec, many runtimes.** The compiled brain is a documented,
   runtime-neutral format; pip and npm are native peers (no Python required
   of Node users) kept honest by shared conformance fixtures.
9. **Agent-agnostic by birth.** MCP, CLI, and plain files play no favorites
   among harnesses. In this repo, AGENTS.md is the one agent-facing
   document; CLAUDE.md is just \`@AGENTS.md\`.
10. **Onboarding is magic, not a manual.** One command from zero to a living
    brain: detect, propose, compile, glow. No API key for the first wow.
11. **Local-first, spec-true.** Offline is a first-class deployment; cloud
    is a convenience. Stay OKF-compliant; push conventions upstream, never
    fork.
12. **Perfect UX and AX are fruits of great DX.** The artifact spec, TDD,
    conformance fixtures, the henxels contract, and codumented docs are how
    the agent- and human-facing surfaces stay perfect.
13. **The family eats its own dog food.** This repo is governed by henxels
    and codumented from day one, and every feature is exercised on a real
    brain — bugs in any sibling tool surface at home first.
`;

export const validate = async () => {
  const root = path.join(__dirname, '..');

  const numbered = content.match(/^\s{0,3}\d+\.\s+\*\*/gm) ?? [];
  if (numbered.length !== 13) {
    throw new Error(`The section must list exactly 13 principles; it lists ${numbered.length}`);
  }

  // Principle 9: CLAUDE.md is exactly "@AGENTS.md", AGENTS.md is the one agent doc
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
  if (claude.trim() !== '@AGENTS.md') {
    throw new Error('Principle 9 claims CLAUDE.md is just "@AGENTS.md" but it contains something else');
  }
  if (!fs.existsSync(path.join(root, 'AGENTS.md'))) {
    throw new Error('Principle 9 points agents at AGENTS.md but the file does not exist');
  }

  // Principle 13: this repo is governed by henxels
  if (!fs.existsSync(path.join(root, 'henxels.yaml'))) {
    throw new Error('Principle 13 claims this repo is governed by henxels but henxels.yaml is missing');
  }

  // Principle 2: compiled artifacts are disposable, so .brainpick/ must be gitignored
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
  if (!gitignore.split('\n').some((l) => l.trim() === '.brainpick/')) {
    throw new Error('Principle 2 treats .brainpick/ as disposable but .gitignore does not ignore it');
  }
};

export const errorContent = `
[Validation Failed] The "Principles" section drifted from reality.

The thirteen principles are this project's constitution — fix the repo, not
the principle: CLAUDE.md must contain exactly "@AGENTS.md" (principle 9),
henxels.yaml must govern this repo (principle 13), and .gitignore must ignore
.brainpick/ (principle 2). Changing a principle itself is Tom's call: discuss
first, then update README.md.codx/principles.ts.
`;
