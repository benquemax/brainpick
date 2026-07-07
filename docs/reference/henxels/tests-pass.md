---
type: Reference
title: "Henxel: the Python engine's tests pass"
description: "The pre-commit henxel that runs the Python engine's pytest suite, because tests define the feature set."
timestamp: 2026-07-08T00:00:00Z
---

# Henxel: the Python engine's tests pass

This henxel runs the Python engine's suite before every commit
(`run_before_commit: cd packages/python && uv run --extra dev pytest -q`). Tests
define the feature set, and the feature set must always work (principle 12) — so
no commit lands with a red suite.

Its pre-push counterpart, covering every engine and e2e, is
[Henxel: the whole feature set works](whole-feature-set.md). Back to [Henxels contract reference](../../reference-henxels.md).
