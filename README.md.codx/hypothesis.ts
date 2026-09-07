import * as fs from 'fs';
import * as path from 'path';

export const content = `## The hypothesis

A small model with **frictionless access to knowledge and skills that
evolve in real time** becomes a self-improving agent — and not merely as
capable as an agent on a large frontier model, but *more* capable than one
whose large model lacks that access. The large model's knowledge is frozen
at training time; the brain's is corrected the moment an agent notices it
was wrong.

Brainpick is built on that bet. Its target architecture puts *just enough*
intelligence inside the model — reading, reasoning, tool use — and keeps
knowledge and skills **outside** it, in a brain that any agent can read,
ground, and improve as it works:

- **Less VRAM and compute.** Skills and facts are not baked into weights, so
  the model that runs them can be a 27B on your own machine (principle 1),
  not a data-center model. Learning something new is a commit, not a
  fine-tune.
- **A better, more current world model.** A brain is corrected in real
  time by every agent that uses it, grounded to its sources, and refereed
  on every write — where a large model's understanding is as old as its
  training cut-off and as opaque as its weights.
- **More intelligence per kWh.** The same task done by a small model over a
  living brain costs a fraction of the energy of a frontier model rediscovering
  the answer from scratch — and the second time, the answer is a skill.

**A sub-hypothesis: the knowledge graph must be regenerated from the
repository, never accumulated.** Brainpick's graph is a derived artifact —
compiled from the files, disposable, rebuilt from scratch whenever asked
(\`brainpick compile --full\`, or \`rm -rf .brainpick/\`; once a week is a
fine habit). That is what lets the associations *evolve*: when a doc is
distilled, split or corrected, its links, backlinks, vectors and entities
are recomputed from what the repository says *now*, not patched onto what
it said before. A store that accumulates — a hand-tended index, a vector
database fed incrementally, weights fine-tuned on last month's facts —
carries every stale association forward and cannot be rebased. Because the
brain is a repository, the knowledge and skills an LLM reads are always
rebased onto the current state, frictionlessly, the same way code is.

Everything else in this README is engineering in service of that bet: the
[brain format](https://github.com/benquemax/brainpick/blob/main/spec/85-brain-format.md)
turns notes into memory with a data flow (journals → knowledge → skills),
[henxels](https://github.com/benquemax/henxels) keeps every write true so the
brain can be trusted, and the tiers make retrieval cheap enough that a small
model never has to *remember* — only to *look*. The hypothesis is testable and
we intend to test it: the same tasks, a small model with a brain against a
large one without, measured in outcomes and in watt-hours.

`;

export const validate = async () => {
  const root = path.join(__dirname, '..');

  // The hypothesis is the "why" of principle 1 and of the vision's target
  // profile — both must keep saying small models are the design target.
  const vision = fs.readFileSync(path.join(root, '_vision.md'), 'utf-8');
  if (!/Small local models are first-class citizens/.test(vision)) {
    throw new Error('The hypothesis rests on _vision.md naming small local models as first-class citizens');
  }
  if (!/## The hypothesis/.test(vision)) {
    throw new Error('The hypothesis must be stated in _vision.md (the north star), not only in the README');
  }
  for (const claim of ['VRAM', 'kWh', 'self-improving', 'regenerated from the\nrepository']) {
    if (!content.includes(claim)) {
      throw new Error(`The hypothesis section must keep its three claims; "${claim}" is missing`);
    }
  }

  // The sub-hypothesis rests on the artifacts being disposable and a from-scratch
  // rebuild existing: spec/00 must say so and the CLI must offer --full.
  const spec00 = fs.readFileSync(path.join(root, 'spec', '00-overview.md'), 'utf-8');
  if (!/rm -rf `?\.brainpick\/`?/.test(spec00)) {
    throw new Error('The sub-hypothesis claims the graph is disposable, but spec/00 no longer says rm -rf .brainpick/ is safe');
  }
  const cli = fs.readFileSync(path.join(root, 'packages', 'python', 'src', 'brainpick', 'cli.py'), 'utf-8');
  if (!cli.includes('"--full"')) {
    throw new Error('The sub-hypothesis names `brainpick compile --full`, but the CLI has no --full flag');
  }

  // The brain format it points at is a real spec section with a data flow.
  const spec = fs.readFileSync(path.join(root, 'spec', '85-brain-format.md'), 'utf-8');
  if (!/## Data flow architecture/.test(spec)) {
    throw new Error('The hypothesis points at the brain format\'s data flow, but spec/85 has no such section');
  }
  if (!fs.existsSync(path.join(root, 'docs', 'the-hypothesis.md'))) {
    throw new Error('The hypothesis has no concept page (docs/the-hypothesis.md)');
  }
};

export const errorContent = `
[Validation Failed] The "The hypothesis" section drifted from reality.

The bet on small models must be stated in _vision.md (## The hypothesis) and
in docs/the-hypothesis.md, keep its claims (VRAM, kWh, self-improving, regenerated from the repository),
and point at a spec/85 that has a data flow architecture. Fix the repo, or
edit README.md.codx/hypothesis.ts if the bet itself changed (Tom's call).
`;
