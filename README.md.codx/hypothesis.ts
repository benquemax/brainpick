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

**A sub-hypothesis: a knowledge graph only evolves if it can be rebuilt on
every commit.** Knowledge accumulates in the repository — every commit builds
on the ones before, with history, diff and review — and the graph is
*generated* from it. Brainpick's graph is algorithmic: links, backlinks,
tags, entities and relations are derived from the files in under a second,
so it is rebuilt on every commit and always reflects everything the brain
has learned. Compare the widely used LLM-extracted graphs (LightRAG,
GraphRAG): built from scratch by a model, expensive enough to run only once
in a while, and so outdated from day one — and because the model re-derives
every association from zero, the graph never *credits* what the brain
already knew; nothing an agent learns today makes tomorrow's graph better.
Brainpick ran LightRAG early on and removed it for exactly that reason —
there is no LLM extractor in the mix any more, and the graph is derived
algorithmically in both engines
([ADR](https://github.com/benquemax/brainpick/blob/main/docs/reference/adr/similarity-gap-detector.md)).
A graph that is cheap enough to follow every commit is one the brain can
evolve *with*; a graph that is too expensive to follow the brain is a
snapshot of it. Yes, this is reinventing knowledge graphs — on the premise
that the associations belong in the files, where agents can improve them,
and the graph is what the files say today.

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
  for (const claim of ['VRAM', 'kWh', 'self-improving', 'rebuilt on\nevery commit']) {
    if (!content.includes(claim)) {
      throw new Error(`The hypothesis section must keep its three claims; "${claim}" is missing`);
    }
  }

  // The sub-hypothesis is grounded in lived experience: LightRAG was T3 and was
  // removed; the ADR it points at must still say so, and T3 must still derive
  // algorithmically (the graph can only follow every commit if no model is needed).
  const adr = fs.readFileSync(path.join(root, 'docs', 'reference', 'adr', 'similarity-gap-detector.md'), 'utf-8');
  if (!/LightRAG/.test(adr)) {
    throw new Error('The sub-hypothesis cites the similarity-gap-detector ADR for dropping LightRAG, but the ADR no longer mentions it');
  }
  // "No LLM extractor in the mix": neither engine may depend on lightrag, and
  // the config must still treat the removed value as a fallback, not a backend.
  const pyproject = fs.readFileSync(path.join(root, 'packages', 'python', 'pyproject.toml'), 'utf-8');
  const nodePkg = fs.readFileSync(path.join(root, 'packages', 'node', 'package.json'), 'utf-8');
  if (/lightrag/i.test(pyproject) || /lightrag/i.test(nodePkg)) {
    throw new Error('The sub-hypothesis says there is no LLM extractor in the mix, but an engine depends on lightrag');
  }
  const pyConfig = fs.readFileSync(path.join(root, 'packages', 'python', 'src', 'brainpick', 'config.py'), 'utf-8');
  if (!/removed "lightrag"/.test(pyConfig)) {
    throw new Error('config.py no longer documents "lightrag" as a removed value that falls back to algorithmic');
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
in docs/the-hypothesis.md, keep its claims (VRAM, kWh, self-improving, rebuilt on every commit),
point at a spec/85 that has a data flow architecture, and cite an ADR that
still records dropping LightRAG. Fix the repo, or
edit README.md.codx/hypothesis.ts if the bet itself changed (Tom's call).
`;
