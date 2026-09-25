# Contribute — read-only implants and proposing changes upstream

> **Status: PROPOSED — the Python engine implements the registry flag, the
> refusals, `brain_contribute` and the patch rung of `brain_submit`; the
> forge rungs and the Node engine follow.** MUST/MUST NOT language states
> the contract so it can be argued with. Review target: the boundaries
> (the served checkout is never written, no general git surface, nothing
> is ever sent to a remote the agent does not own) rather than field names.

An agent mounts implants it does not own. A public knowledge implant —
philosophy, cognitive tools, a company handbook — is cloned from someone
else's repository, and the agent has no right to push there. Today spec/75
makes every implant writable and spec/100's `brain_push` commits to the
served checkout and pushes to `origin`: on a repository the agent cannot
write, that produces a local commit that diverges from upstream, and the
next `git pull --ff-only` fails. The knowledge the agent wanted to add is
now stranded on one machine in a repository that should have stayed a
mirror.

Two things are wanted, and they are different:

- **Complement** — what the agent (or its user) concludes on top of the
  implant. This belongs in the agent's own memory (its cortex) or in a
  project's implant, linked back to the page it complements. Nothing new
  is needed for this beyond spec/85's `brain://` links and subsidiarity;
  what is missing is that a refused write should *say so*, and that reading
  the implant page should surface the complement.
- **Correct** — the implant itself is wrong or misleading. This belongs
  upstream, as a **pull request** (asking the owners to take a change into
  the original), and it should be as easy as `henxels contribute`: the
  agent produces a merge-ready change checked against the implant's own
  rules, and submission is assisted.

This section keeps two vocabularies on purpose: the exact git term and a
plain-language twin, because the same payloads are read by people who
know what a fork remote is and by people who do not.

## What is NOT specified here

**No general git surface**, as spec/100: two verbs, each a complete
operation with a defined end state. **No forge API in the engine**: a
forge command-line tool (`gh`, `tea`) is used when present and
authenticated; otherwise the agent gets a URL or a patch. Authentication
stays the user's. **No rebasing, no history rewriting**: a proposal whose
base has moved is reported, never rewritten.

## Access is a fact about the mount

Whether an agent may push to a repository is not a property of the
repository (its author's `brainpick.toml` describes *their* deployment)
but of *this machine's* mount of it. It therefore lives in the registry
(spec/75), one key per `[[brain]]`:

```toml
[[brain]]
repo = "/home/me/Git/brain-implant-philosophy"
alias = "philosophy"
role = "implant"
access = "read-only"     # read-write (default) | read-only
```

- `brainpick register PATH --read-only` sets it; `--read-write` clears it.
  Writers emit `access` after `role` in the key order; readers treat an
  absent or unknown value as `read-write` (today's behaviour), so an
  existing registry changes nothing on upgrade. The daemon preserves the
  key as it preserves every key it does not interpret.
- The `Brain` of spec/75 carries `access`; `brain_overview`'s per-brain
  listing carries it always (`"access": "read-write" | "read-only"`).
- Engines MUST NOT infer read-only from the remote URL, the transport or a
  probe at server start. An explicit flag; the failure teaches the fix
  (below).

### What read-only changes

| tool | read-write (today) | read-only |
|---|---|---|
| overview / search / read / neighbors / show / contract | unchanged | unchanged; `brains[]` carries `access` |
| `brain_write alias:doc` | guarded write to the checkout | **refused with a redirect** |
| `brain_sync` | merge, doc-wise resolution | **fast-forward only**: `merged: []`, a non-fast-forward state is reported as `diverged`, never merged |
| `brain_push` | commit + push | **refused**: "read-only — use brain_contribute" |
| `brain_contribute` / `brain_submit` | allowed | the only write route |

**The `brain_write` refusal MUST redirect.** A refusal that only says "no"
strands the knowledge the agent was about to record. The payload:

```json
{"ok": false, "brain": "philosophy", "access": "read-only",
 "brain_link": "brain://philosophy-dfz820wadlcig9rxsvz7u/knowledge/biases/anchoring.md",
 "instruction": "philosophy is read-only (a mirror of its upstream). Two routes: (1) COMPLEMENT — write what you concluded into your own brain: brain_write 'me:<path>' and ground it with the brain_link above; (2) CORRECT the implant itself — brain_contribute with the same arguments proposes the change upstream as a pull request."}
```

`brain_link` is the spec/85 cross-brain link, pre-computed from the
target's `[bundle] id` and alias (slug) so the agent pastes it rather than
constructs it; it is `null` when the target has no `[bundle] id`. The
instruction names the cortex's alias when the set has one, else says
"your own brain".

**`brain_push` on a read-write brain whose remote refuses the push**
(permission denied) MUST add to its hint: *"no push rights on this remote
— register this brain `--read-only` and use brain_contribute"*. This is
the one place an engine detects the condition, and it detects it from the
remote's answer, never by guessing.

**`brain_overview`'s hint** gains one line after any skew line when the
set holds read-only brains: *"philosophy, cognitive-tools are read-only —
complement them in me, propose fixes with brain_contribute."*

## Complement: the cortex overlay

A complement is an ordinary doc in a writable brain, grounded with a
`brain://` link to the implant page (spec/85 *Cross-brain links*).
Subsidiarity makes it win: the cortex is closer to the agent than a public
implant. Nothing new is written for that.

What is new is that the link becomes visible from the other end.
**`brain_read` in a federated set gains `annotations`** — every doc in
every *other* brain of the set whose `brain://` links (T1 `kind: "brain"`,
resolved by `brain_id` against the set's `[bundle] id`s) point at the doc
being read:

```json
{"path": "philosophy:knowledge/biases/anchoring.md", ...,
 "annotations": [{"brain": "me", "path": "me:knowledge/anchoring-replication-note.md",
                  "title": "Anchoring: the 2014 replication figure"}]}
```

Present only when non-empty; single-brain payloads are byte-identical.
Ordered by set order then path. This is the reverse lookup that makes
"put your notes in your own brain" a usable instruction: reading the
implant surfaces the note, and the agent never has to remember it exists.

## Correct: proposals in a worktree

A **proposal** is a branch of the implant's repository holding one or more
commits the agent wants upstream. It lives in a **git worktree** — a
second checkout of the same repository in another folder, sharing its
object store and its hooks — so the served checkout stays exactly what
upstream has, clean and fast-forwardable. Engines MUST NOT modify the
served checkout of a read-only brain, ever, on this path.

Worktrees live under `$XDG_DATA_HOME/brainpick/proposals/<bundle-id>/<name>/`
(`BRAINPICK_PROPOSALS` overrides the base), one per proposal; the branch
is `contrib/<name>`. `<bundle-id>` is the target's `[bundle] id`, else the
registry `id`. `<name>` is slugified to `[a-z0-9-]`.

### brain_contribute({brain, doc, content, mode?, base_sha?, message, proposal?})

The arguments of `brain_write` plus `message` (required — an engine never
invents a commit message for shared memory, spec/100) and `proposal` (a
name; default: the doc's file stem). In a federated set `brain` is
required; `doc` is bundle-relative (an `alias:` prefix naming the same
brain is accepted and stripped).

1. **Fresh base.** `fetch` the upstream. The proposal branch is created
   from `origin/<default branch>` (in plain words: from the newest
   upstream version), never from the local checkout, which may be behind.
   A fetch failure is reported in `hint` and the branch is created from
   the remote-tracking ref as last fetched.
2. **Worktree.** Created on the first call for `<name>`; reused after.
   A worktree whose branch no longer exists is recreated.
3. **Guarded write in the worktree.** The full spec/70 ladder — `create`
   never overwrites, `base_sha` catches concurrent edits, `three-way`/
   `llm` proposals on mismatch — evaluated against the worktree's copy of
   the doc. The contract that runs is the *target repository's* own
   (`henxels.yaml` plus its `henxels_checks.py`) over the worktree, exactly
   as spec/100's `brain_push` runs it: passed → continue; failed → refuse
   with the output verbatim and the file left unwritten; could not be run
   while a contract exists → refuse with `contract: "unavailable"`.
4. **Compile the worktree bundle** so a `--check-fresh` hook passes. Its
   `.brainpick/` is disposable and never served.
5. **Commit** with `message`; hooks always run, never `--no-verify`. A
   hook rejection is returned as `instruction` and the file change is
   left in the worktree, uncommitted, so the agent can fix and call again.
6. **Return**, first contact included:

```json
{"ok": true, "brain": "philosophy",
 "proposal": {"name": "anchoring-replication", "branch": "contrib/anchoring-replication",
              "base": "a6cd50d3", "commits": 1, "stale_base": false,
              "files": ["_implant/knowledge/biases/anchoring.md"],
              "worktree": "/home/me/.local/share/brainpick/proposals/dfz8…/anchoring-replication"},
 "contract": "pass",
 "read_first": ["skills/write-a-page.md", "conventions/index.md"],
 "hint": "1 commit on contrib/anchoring-replication (in your working copy for this proposal, not in the mounted implant). Add more with proposal='anchoring-replication', then brain_submit to open the pull request. Read read_first: the implant's own rules for contributions."}
```

**First contact is apply-and-brief.** The write is applied, and the
payload carries `read_first`: the implant's declared contribution guide.
Engines resolve it as `[brain] contributing` in the target's
`brainpick.toml` (a list of bundle-relative paths), else `CONTRIBUTING.md`
at the repo root when present, else the bundle's `conventions/index.md`
when present; empty otherwise. It is carried on every `brain_contribute`
response — a proposal is cheap to amend, a hard stop punishes the
small-model caller, and repeating the pointer costs nothing.

Several calls accumulate on one proposal. A real contribution to a
governed implant is a page fix *plus* the journal line its conventions
demand *plus* perhaps a `raw/` excerpt — several writes, one branch, one
pull request.

`stale_base` is true when `origin/<default>` has moved past the
proposal's base since it was created. It is reported, never acted on: the
agent may drop and redo, or submit as-is and let the maintainer rebase.

**Drop.** `brain_contribute({brain, proposal, drop: true})` removes the
worktree and its branch; nothing else. Nothing is ever dropped
automatically, including merged proposals.

### brain_submit({brain, proposal, title?, body?})

Publishes the proposal — **to the agent's own copy of the repository (its
fork), never to the original (origin)**. A ladder; the top rung that works
wins and every rung reports honestly:

| rung | condition | does | returns |
|---|---|---|---|
| `forge-cli` | `gh` (GitHub) or `tea` (Gitea) on PATH, authenticated, origin is that forge | forks once (`gh repo fork --remote --remote-name fork`), pushes the branch to `fork`, opens the pull request | `pr_url`, `number` |
| `fork-remote` | a git remote named `fork` exists | pushes the branch to `fork` | `compare_url` (`<origin web URL>/compare/<default>...<fork owner>:<branch>?expand=1`, honoured by GitHub and Gitea) and the drafted title/body to paste |
| `patch` | nothing above | `git format-patch <base>..<branch>` into the proposal worktree's parent | `patch_path`, the draft body, the origin URL — "attach to an issue or send by mail" |

`rung` names which one ran. Never an error for lacking a forge — a
proposal that cannot be submitted from here is still a proposal.

**Drafting, not inventing.** `title` defaults to the first commit's
subject. `body` defaults to a draft assembled only from data the engine
has — the agent's commit messages, the files touched with their modes,
the contract outcome, and the base commit — and MUST end with a checks
block the agent cannot fake:

```
## What
- anchoring: correct the replication effect size to the value at DOI …

## Pages
- _implant/knowledge/biases/anchoring.md
- _implant/journals/2026-09-26.md

## Checks (run locally, the implant's own contract)
- henxels contract: pass
- brainpick compile --check-fresh: pass
- base: a6cd50d3 (origin/main at submission)

_Proposed through brainpick brain_contribute. The checks are the implant's
own contract; the claims are the contributor's._
```

A caller-supplied `body` replaces the `What` section; the checks block is
always appended.

→ `{"ok", "brain", "proposal", "rung", "pr_url"?, "number"?,
"compare_url"?, "patch_path"?, "title", "body", "stale_base", "hint"}`.

### Lifecycle

`brain_status({brain})` gains `proposals`, present when any exist:

```json
{"proposals": [{"name": "anchoring-replication", "branch": "contrib/anchoring-replication",
                "commits": 1, "stale_base": false, "merged": false,
                "submitted": {"rung": "fork-remote", "compare_url": "…"}}]}
```

`merged` is true when `origin/<default>` contains the branch tip after
the fetch `brain_status` already does. The hint names merged proposals as
droppable. After a merge, `brain_sync` fast-forwards the served checkout
and the fix is live in the mounted implant.

Submission state is recorded in the worktree's git config
(`brainpick.submitted.rung`, `.url`) so it survives a server restart and
never touches the served checkout.

## Exposure

```toml
[serve]
git = "off"    # off | status | sync | contribute | push
```

The spec/100 ladder gains a rung between `sync` and `push`. Climbing
upwards, each rung includes everything below: `contribute` enables
`brain_status`, `brain_sync`, `brain_contribute` and `brain_submit`. It
sits *below* `push` because nothing on it writes a remote the agent does
not own: commits land on a worktree branch, and submit sends them only to
the agent's own copy (the `fork` remote). A machine may therefore allow
contributing without allowing pushing. The level is read from the
*mount's* config exactly as spec/100 reads `git` today (the implant
author's committed toml does not decide what this machine exposes;
`brainpick.local.toml` does). The same non-localhost bearer-token rule
applies.

On a read-only brain `brain_push` is exposed by the ladder (so the
tool list does not change per brain) but refuses at call time with the
redirect. A refusal that names the right verb is cheaper than a tool that
appears and disappears with the `brain` argument.

## Conformance

Class `contribute` (cases.yaml), operating on a local bare "origin"
fixture with no network:

- after `brain_contribute` on a read-only brain: the branch exists with
  one commit, the served checkout's `HEAD`, working tree and index are
  unchanged, and the payload's `files` names the doc;
- `brain_write` on the same brain refuses with `access: "read-only"` and
  a `brain_link`;
- `brain_submit` at the `patch` rung yields a patch file whose diff
  applies cleanly to origin's default branch.

The forge rungs are covered by unit tests with a fake `gh` on PATH, not
by conformance.
