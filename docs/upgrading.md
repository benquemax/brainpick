---
type: playbook
about: process
title: Upgrading a brain
description: "Bring an existing brain to the current release in one sitting — upgrade the engine, migrate the format, install the ritual, retype skills, register — by walking brainpick whats-new's numbered Do next list top to bottom."
tags: [agents, brain, brain-format]
timestamp: 2026-09-13T14:00:00Z
---

# Upgrading a brain

An agent that finds itself on a newer engine than the one that last
compiled its brain has one command to run and one list to walk. This page
is that walk for a format-1 brain meeting 0.6.0; the mechanism is general.

1. **Upgrade the engine** where the [Update notice](update-notice.md) says
   to (`uv tool upgrade brainpick`, `pipx upgrade brainpick`, or
   `npm i -g brainpick`).
2. **Compile.** `brainpick compile --root <bundle>` prints
   `note: what's new — …` naming both gaps: the releases since the last
   compile and the brain format behind.
3. **Read the checklist.** `brainpick whats-new` prints the releases and
   then **Do next**, numbered in the order to do them — the oldest missed
   release's actions first, the brain format last
   ([What's new notice](whats-new.md)). For a format-1 brain on 0.6.0 it
   reads:
   1. `brainpick migrate --to 2` (`--dry-run` first) — month journals into
      day files, links onto them, `_todo.md` into `todo/open.md`, the
      stamp, and the `[half_life]` defaults seeded into `brainpick.toml`
      ([brainpick migrate](reference/cli/migrate.md)).
   2. `brainpick integrate agents-md` (or the harness target) — the
      [brain ritual](brain-ritual.md) block lands below the report.
   3. Retype agent-facing `type: playbook` docs to `type: skill`
      ([Skills](skills.md)); new procedures via `brainpick skill new`.
   4. Steepen a folder's half-life only when the lists silt up
      ([Half-life](half-life.md)).
4. **Review, compile, commit, push.** `git diff` is the review — migrate
   prints every action it took — then `brainpick compile`, and the pull /
   push half of the ritual carries the migrated brain to every other
   machine that shares it.

A brain governed by the henxels `brainpick-brain` template has one more
step outside brainpick: `henxels init` prints the contract fragment for the
new layout ([The brain template](brain-template.md)). A brain the agent
misses is not lost: the format part of the notice stays at every compile
until the migration runs, and the release part clears itself once the
brain is compiled by the running version.
