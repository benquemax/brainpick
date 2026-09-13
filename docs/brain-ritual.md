---
type: article
about: concept
title: The brain ritual
description: "Four habits that make a brain shared memory rather than a read-only index — pull and compile first, consult before grepping, record while working, commit and push last — installed by brainpick integrate as a fenced block in AGENTS.md and repeated in the Agent Skill."
tags: [agents, brain]
timestamp: 2026-09-14T15:00:00Z
---

# The brain ritual

A compiled brain that nobody pulls drifts; one that nobody pushes stays on
one machine. The [Agent Skill](agent-integrations.md) and the AGENTS.md
report both say *consult the brain before grepping* — the read half of
memory. The **ritual** is the whole loop, and
[brainpick integrate](reference/cli/integrate.md) installs it where every
harness already looks:

```
<!-- brainpick:begin ritual (v3) -->
…
<!-- brainpick:end ritual -->
```

1. **Start: pull, then compile.** `git pull --ff-only` in every brain repo,
   then `brainpick compile --root .` from the repo root — `--root` names
   where `brainpick.toml` lives and [bundle.root](reference/config/bundle-root.md)
   names the bundle from there; aiming `--root` at the bundle subdirectory
   compiles with defaults. `.brainpick/` is gitignored, so a pull alone
   leaves the brain stale, and compile is where the
   [What's new notice](whats-new.md) speaks. If it does, `brainpick
   whats-new` and its *Do next* list come before the task.
2. **Consult before grepping or answering from memory.** `brain_overview`,
   then `brain_search` → `brain_read` → `brain_neighbors`; grep only after
   the brain comes up short. [Conventions](conventions.md) listed in the
   overview are standing rules that apply to the agent — read before
   acting; [Skills](skills.md) listed there are procedures that have
   worked.
3. **Record while you work.** A wrong fact is fixed where it was found; a
   decision, a contact, an insight goes to the folder the brain's
   conventions name — today's journal, `todo/open.md`
   ([To-do lists](todo-lists.md)). If the brain lacked something the task
   needed, it is added so the next session does not rediscover it.
4. **Finish: commit and push.** A change that sits on one machine is not
   shared memory.

The text is one canonical file, `integrations/ritual/RITUAL.md`, shipped in
both packages byte-identical and pinned as a conformance golden (class
`ritual`), so every engine installs the same words. It is *static*: the
`(v3)` is the text's own version, not a hash — compile never regenerates
the block, and integrate replaces it in place only when a newer canonical
ships. v3 added conventions to step 2; v2 corrected v1's compile line, which said `--root <bundle>` and,
mechanised from `brainpick register`'s path, aimed at the bundle instead
of the config — every repo integrate touches again self-heals. `agents-md` creates the file when there is none; the harness targets
(`claude-code`, `opencode`, `dsh`) install the block only into an
`AGENTS.md` that exists, directly below the [brain report](agent-integrations.md),
and say so when there is none. The Agent Skill repeats the four habits, so
a harness that loads skills but not AGENTS.md hears them too.

It is advice with commands in it, not a gate — the same stance as the
[Update notice](update-notice.md): the engine never blocks a session, it
makes the right thing the obvious next line to type. Fleet-wide instruction
files can shrink to "run `brainpick integrate agents-md` where the block is
missing"; the block carries the rest and updates with the engine.
