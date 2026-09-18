# Sync — pulling and pushing shared memory from the tools

> **Status: PROPOSED — no engine implements this.** Nothing here is
> conformance-tested yet and no release ships these tools. The MUST/MUST
> NOT language states the contract an implementation would have to meet, so
> that it can be argued with before two engines encode it. Review target:
> the boundaries (no general git surface, no auto-commit, hooks never
> bypassed, default `off`) rather than the payload field names.

A brain is shared memory held in Git (spec/85). Every machine that mounts
it is a writer, so the bundle on disk is a checkout that drifts: another
agent commits between two of your tool calls, another machine edits the
same journal on the same day, and a push from here lands on top of work
that is not here yet. spec/70 *Freshness* closed the gap between the
artifacts and the process reading them. This section closes the gap between
the checkout and its remote.

The motivation is not convenience. An agent that can consult and write a
brain through MCP, but must shell out to `git` to share it, forces its host
to hand the session general filesystem access for the one step that is
least forgiving of a mistake. Sync belongs to the tool surface for the same
reason `brain_write` does: a narrow audited verb on one bundle is a smaller
grant than a shell.

## What is NOT specified here

**No general git surface.** Engines MUST NOT expose `git` as a tool —
no arbitrary subcommand, no `checkout`, no `reset`, no `rebase`, no
history rewriting, no remote management. The verbs below are the whole
surface, they act only on the bundle's repository, and each is a complete
operation with a defined end state. An agent that needs anything else uses
a shell, deliberately, outside this contract.

**Conflict markers are never written to a doc.** Git's textual resolution
assumes a human opens an editor. In a brain the same bytes are corruption:
`<<<<<<<` inside frontmatter is invalid YAML, which fails the henxels
contract, fails the compile, and hands the next agent a broken bundle.
Engines MUST NOT leave a file containing conflict markers in the working
tree — a doc that cannot be resolved is reported, not mangled (below).

## The three verbs

| Tool | Reads remote | Writes working tree | Writes history | Writes remote |
|------|--------------|---------------------|----------------|---------------|
| `brain_status` | yes (`fetch`) | no | no | no |
| `brain_sync` | yes | yes | merge commit only | no |
| `brain_push` | yes | no | yes (commit) | yes |

The split is deliberate: the read-only verb is safe to enable everywhere,
resolution never publishes, and publishing is a separate decision an agent
makes after reading what resolution produced.

## brain_status({brain?})

Fetches the bundle's remote and reports the checkout's relationship to it.
Fetch only — never merges, never modifies the working tree.

→ `{"brain", "branch", "upstream", "ahead", "behind", "dirty":
{"modified", "untracked", "staged"}, "conflicts": [path…], "clean",
"hint"}`.

`ahead`/`behind` are commit counts against the upstream branch. `clean` is
true iff `ahead == 0 && behind == 0` and nothing is dirty. `conflicts`
lists paths left unresolved by a previous `brain_sync` (empty normally).
A bundle with no repository, no remote or no upstream returns the shape
with `upstream: null` and a `hint` saying so — never an error, because a
brain that is not shared is a valid brain.

This satisfies spec/85's existing "engines MAY report a checkout that is
behind its remote". It is read-only and SHOULD be available whenever the
brain tools are.

## brain_sync({brain?, budget_tokens?})

Brings the remote's work into the checkout and resolves what collides.

1. `fetch` the upstream.
2. Nothing to do (`behind == 0`) → return early, `merged: []`.
3. A dirty working tree is stashed for the duration and restored after;
   a stash that cannot be restored cleanly is itself reported as a
   conflicted path rather than dropped.
4. Merge the upstream. A clean merge → recompile, return.
5. For each conflicted path, resolve it **doc-wise**, not line-wise
   (below), and write the product to the working tree.
6. Recompile (spec/70 adoption then makes the result visible to every
   subsequent tool call) and return.

→ `{"ok", "brain", "behind_before", "merged": [{"path", "strategy"}],
"unresolved": [{"path", "theirs", "yours", "reason"}], "committed": false,
"hint"}`.

### Doc-wise resolution

A conflicted path has three versions in the merge index, and they are
exactly the inputs the `brain_write` ladder (spec/70) already takes:

| Merge index stage | Ladder input |
|-------------------|--------------|
| `:1:<path>` (merge base) | `base` |
| `:2:<path>` (ours) | `yours` |
| `:3:<path>` (theirs) | `theirs` |

Engines MUST run the spec/70 proposal ladder over those three inputs, in
the same order and with the same strategies: mechanical `three-way` when
the base is known and the edits do not overlap; `llm` through the
configured `[models.extraction]` chat model when they do; neither → the
manual path. The strategy MUST be reported per path.

This is one ladder with two callers, not two merge engines. A brain's
conflicts are overwhelmingly prose — two agents appending findings to one
journal day — and prose merges badly by line and well by meaning, which is
why the `llm` rung exists at all. A path the ladder cannot resolve is
returned in `unresolved` with both versions (budget-shaped) and the
working tree left at the pre-merge state for that path. It is never
written with markers.

### Nothing is committed

`brain_sync` MUST NOT create a commit for resolved docs, and MUST NOT
push. `committed` is always `false`. The merge leaves its result staged
and the agent reads it before publishing.

This is the same contract `brain_write`'s `merged` already carries —
*every product here is a PROPOSAL, callers never auto-apply* — and it
holds here for a stronger reason: a three-way merge that succeeds
mechanically is precisely the case where nobody looked at the text. Two
agents can each append a correct fact to a journal and produce a merge
that is clean, valid, and says two contradictory things. The ladder
resolves *structure*; only a reader resolves *truth*.

## brain_push({brain?, message})

Publishes the checkout. `message` is required — an engine MUST NOT invent
a commit message for shared memory.

1. Refuse when `brain_status` reports `conflicts` — unresolved work is
   never published.
2. Refuse when `behind > 0` — the agent runs `brain_sync` first. Engines
   MUST NOT pull implicitly here; that is spec/85's MUST NOT, and it holds
   for the same reason at the other end of the path.
3. Compile before committing, so the freshness marker matches the sources
   the commit contains. A brain whose contract runs `--check-fresh` on
   pre-commit will otherwise reject the very commit this tool is making.
4. Stage the bundle, commit, push.

→ `{"ok", "brain", "commit", "pushed", "hint"}`.

**Hooks always run.** Engines MUST NOT pass `--no-verify`, and MUST NOT
offer an option that does. The henxels contract is the mechanism that keeps
a brain true across machines; a tool that could bypass it would make every
other guarantee in this spec advisory. A hook rejection is returned
verbatim as `{"ok": false, "instruction": …}`, exactly as a `brain_write`
contract violation is (spec/70).

## Configuration and exposure

```toml
[serve]
git = "off"        # off | status | sync | push
```

A ladder, not a set: `status` enables `brain_status`; `sync` enables it and
`brain_sync`; `push` enables all three. Default **`off`** — an engine adds
no git capability to an existing deployment on upgrade.

Exposure rules, which are normative:

- Tools absent from the set MUST NOT appear in `tools/list`. An unavailable
  capability is invisible, not a runtime refusal.
- On a non-localhost bind, `git` values other than `off` MUST additionally
  require the bearer token that already gates `brain_write` (spec/70), and
  `push` SHOULD be refused outright unless explicitly re-enabled, because
  reachability of the port would otherwise imply write access to the
  brain's remote.
- In a federated set (spec/75) every verb takes the `brain` argument and
  acts on exactly one brain. Engines MUST NOT sync or push a set as a unit:
  each brain is a separate repository with a separate remote and a separate
  right to refuse.

## What this does not fix

Two docs in the brain format are structural collision points: `log.md`
(one file, newest-first, every agent appends at the top) and
`journals/YYYY-MM-DD.md` (one file per day, every machine active that day).
Both produce a conflict on essentially every concurrent session, and this
section makes those conflicts survivable rather than rare. Reducing their
frequency is a brain-format question — sharding the append targets so two
machines do not write the same bytes — and belongs to spec/85, not here.
