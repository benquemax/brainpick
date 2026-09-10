---
type: reference
about: thing
title: "brainpick register"
description: "Add a brain to the federation registry — or list it, or remove one — so a single brainpick mcp entry fronts every brain you work with."
tags: [cli, spec, agents]
timestamp: 2026-09-06T16:00:00Z
---

# brainpick register

`brainpick register [PATH] [--alias ALIAS] [--cortex|--implant] [--remove]` (and
`--from-hosts [--dry-run]`) maintains the
federation registry, `~/.config/brainpick/brains.toml` — the same file
[the daemon](../../daemon.md) keeps, so a brain registered here is one the
daemon can supervise and a brain the daemon added is one agents can query
(spec/75, [Spec: federation](../spec/federation.md)).

- `brainpick register PATH` adds the bundle at PATH (updating its entry in
  place when the same root is already there). The entry's `id` is the bundle's
  `[bundle] id` when it has one, else a freshly minted one; `repo` is the git
  repo above the bundle and `bundle_path` the bundle's place inside it.
- `--alias ALIAS` sets the brain's address in tool payloads (`alias:path`);
  the default is the git repo's name, or the directory name outside a repo.
- `--cortex` marks it as the agent's own brain — the `me` scope. There is exactly
  one; the newest claim wins. `--user` is the deprecated spelling, and a
  registry written with `role = "user"` is still read as the cortex.
- `--implant` marks it as an attached repository bundle — any number. An
  implant is queried alongside the cortex and, like it, writable; a write is
  refused only by the implant's own `[serve] writes` setting and its own
  henxels contract.
- `--remove` drops PATH from the registry.
- `brainpick register` with no PATH lists the registry: alias, root, and
  `(me)`, `(implant)`, `(disabled)` or `(missing)` marks (`brainpick register .`
  is the explicit form for the working directory).
- `--from-hosts` is the migration from the pre-federation shape. It scans the
  agent host configs under `$HOME` — `~/.claude.json` (user and per-project
  `mcpServers`), `~/.config/opencode/opencode.json`, `~/.codex/config.toml`,
  `~/.cursor/mcp.json` — for every `brainpick mcp --root DIR` entry and
  registers each DIR exactly as `register DIR` would. An already registered
  root is left alone, a DIR that is not a bundle on this machine is reported
  and skipped, and the command then prints the one user-scope entry that
  replaces them all. It never edits a host config; `--dry-run` only reports.
  Nothing found is a report, not a failure.

A PATH holding no markdown is refused — a brain is an OKF bundle. The
registry's location honors `BRAINPICK_REGISTRY` (the file), then
`BRAINPICK_DAEMON_CONFIG_DIR` and `XDG_CONFIG_HOME`, matching the daemon.

The command exists in both engines (see [runtime parity](../../runtime-parity.md)).
Once registered, [brainpick mcp](mcp.md) without `--root` fronts every
registered brain plus the one you are in — the shape described in
[federation](../../federation.md). Back to [CLI reference](../../reference-cli.md).
