---
type: reference
about: concept
title: "Configuration reference"
description: "Every brainpick.toml key with its default, type and allowed values, derived from config.py and the config spec — plus layering, env overrides and the auth file."
tags: [config, spec]
timestamp: 2026-07-10T18:30:00Z
---

# Configuration reference

Configuration is one TOML file at the bundle root, `brainpick.toml`, with a
machine-local `brainpick.local.toml` deep-merged over it. Every key below is
optional — an absent file means all defaults, so a bundle needs zero config.
Keys and defaults are derived from `config.py` and the configuration spec.
Pages are named by their dotted TOML path.

## Top level

- [spec (config version)](reference/config/spec-version.md)

## bundle

- [bundle.root](reference/config/bundle-root.md)
- [bundle.include](reference/config/bundle-include.md)
- [bundle.exclude](reference/config/bundle-exclude.md)
- [bundle.id](reference/config/bundle-id.md)

## index

- [index.mode](reference/config/index-mode.md)
- [index.file](reference/config/index-file.md)

## modules

- [modules.vectors](reference/config/modules-vectors.md)
- [modules.graph](reference/config/modules-graph.md)
- [modules.ui](reference/config/modules-ui.md)

## models

- [models.embedding](reference/config/models-embedding.md)
- [models.extraction](reference/config/models-extraction.md)

## serve

- [serve.host](reference/config/serve-host.md)
- [serve.port](reference/config/serve-port.md)
- [serve.transports](reference/config/serve-transports.md)
- [serve.watch](reference/config/serve-watch.md)
- [serve.writes](reference/config/serve-writes.md)
- [serve.token](reference/config/serve-token.md)
- [serve.max_asset_bytes](reference/config/serve-max-asset-bytes.md)

## ui

- [ui.max_nodes_mobile](reference/config/ui-max-nodes-mobile.md)
- [ui.default_mode](reference/config/ui-default-mode.md)

## validate

- [validate.henxels](reference/config/validate-henxels.md)

## Layering, overrides and auth

- [Config layering and precedence](reference/config/layering.md)
- [Environment overrides](reference/config/env-overrides.md)
- [The auth file](reference/config/auth-file.md)

Config is written by [brainpick init](reference/cli/init.md) during
[onboarding](onboarding.md). Back to [Reference](reference.md).
