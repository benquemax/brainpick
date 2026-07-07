---
type: Reference
title: "Environment overrides"
description: "Override any config key from the environment — BRAINPICK_<SECTION>_<KEY>, and BRAINPICK_MODELS_<TABLE>_<KEY> for model tables."
timestamp: 2026-07-08T00:00:00Z
---

# Environment overrides

Any configuration key can be overridden from the environment, above both TOML
layers and below CLI flags. The variable name is `BRAINPICK_<SECTION>_<KEY>`
uppercased — for example `BRAINPICK_SERVE_PORT`, `BRAINPICK_BUNDLE_ROOT`. Model
tables use `BRAINPICK_MODELS_<TABLE>_<KEY>`, such as
`BRAINPICK_MODELS_EMBEDDING_ENDPOINT`.

Values are coerced to the key's type: booleans read `1/true/yes/on` and
`0/false/no/off`, lists split on commas. This is the env rung of
[Config layering and precedence](layering.md); the full precedence chain is in
[Spec: configuration](../spec/config.md). Back to [Configuration reference](../../reference-config.md).
