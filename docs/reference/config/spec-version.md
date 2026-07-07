---
type: Reference
title: "spec (config version)"
description: "The top-level spec key that names the config/spec version a bundle targets — default 0.1."
timestamp: 2026-07-08T00:00:00Z
---

# spec (config version)

`spec` is the one top-level key, naming the spec version the bundle's config
targets. Default `"0.1"`. It is coerced to a string and, like every key, is
optional — an absent value keeps the default.

It pairs with the [Spec: manifest](../spec/manifest.md)'s `spec_version` field,
which records the version a compile actually produced. See the whole file in
[Spec: configuration](../spec/config.md). Back to [Configuration reference](../../reference-config.md).
