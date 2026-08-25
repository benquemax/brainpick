---
type: decision
about: concept
title: "ADR: PyPI first, npm parked"
description: "Why v0.1 publishes to PyPI only — the Node engine stays a native peer in the repo, but the npm registry release waits until there is demand to serve."
tags: [governance]
timestamp: 2026-08-25T12:00:00Z
---

# ADR: PyPI first, npm parked

**Context.** [ADR: ship the full stack in one v0.1 release](full-stack-v0-1.md)
held publishing until the whole stack existed; it now does, and the release
pipeline is verified end-to-end. But brainpick's natural audience — agent
builders keeping markdown knowledge bases — lives overwhelmingly in the
Python ecosystem, and neither registry name is actually held until something
publishes.

**Decision.** v0.1 publishes to PyPI only. The npm publish job is removed
from the release workflow; the pip package is the supported install and the
README onboarding is pip-first. The Node engine loses nothing: it remains a
native peer proven by the conformance harness
([Runtime parity](../../runtime-parity.md)), version lockstep still gates
every release, and the npm package keeps building from a checkout.

**Alternatives considered.** Publish both registries at once — rejected: an
npm presence without npm users is a standing maintenance promise (tokens,
dist-tags, deprecations) that serves nobody yet, and the release surface
should be as small as the audience it serves.

**Consequences.** One credential handshake instead of two, and a single
supported install path to document. The npm name stays unclaimed — an
accepted squatting risk. Unparking is deliberately cheap: revert the
workflow commit, add an `NPM_TOKEN` secret, and the next tag ships both.
Back to [Architecture decision records](../../reference-adr.md).
