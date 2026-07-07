---
type: Reference
title: "Henxel: the whole feature set works"
description: "The pre-push henxel that runs the Node, webui and e2e suites — the full regression armor before anything reaches the remote."
timestamp: 2026-07-08T00:00:00Z
---

# Henxel: the whole feature set works

This henxel runs the Node, webui and end-to-end suites before every push
(`run_before_push: npm test -w packages/node && npm test -w packages/webui &&
npm run e2e -w packages/webui`). The push gate is the full regression armor;
nothing reaches the remote with a broken feature set.

It complements the per-commit [Henxel: the Python engine's tests pass](tests-pass.md)
and the docs gate [Henxel: documented claims stay true](docs-truth.md). Together
they keep [runtime parity](../../runtime-parity.md) honest. Back to [Henxels contract reference](../../reference-henxels.md).
