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
  for (const claim of ['VRAM', 'kWh', 'self-improving']) {
    if (!content.includes(claim)) {
      throw new Error(`The hypothesis section must keep its three claims; "${claim}" is missing`);
    }
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
in docs/the-hypothesis.md, keep its three claims (VRAM, kWh, self-improving),
and point at a spec/85 that has a data flow architecture. Fix the repo, or
edit README.md.codx/hypothesis.ts if the bet itself changed (Tom's call).
`;
