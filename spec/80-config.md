# Configuration — brainpick.toml

One file at the bundle root (or the repo root, with `[bundle] root`
pointing at the bundle). TOML; identical semantics in both engines;
environment variables `BRAINPICK_<SECTION>_<KEY>` override; CLI flags
override both. Absent file → all defaults (a bundle needs zero config).

```toml
spec = "0.1"

[bundle]
root = "."
include = ["**/*.md"]
exclude = []                    # .brainpick/, .git/, _temp/, node_modules/ always excluded
id = ""                         # a random opaque identifier minted by `brainpick init`

[index]
mode = "section"                # manage | section | off
file = "index.md"

[modules]                       # T1 has no switch
vectors = "auto"                # auto | on | off   (T2 — M2)
graph = "on"                    # on (default, "algorithmic" accepted as a
                                # synonym) | auto | off — the algorithmic
                                # backend derives entities from links/tags,
                                # no model needed (spec/40)
similarity_gaps = "auto"        # auto (on iff T2 is fresh) | on | off — the
                                # gap-detector report (spec/45)
ui = true

[similarity_gaps]
threshold = 0.75                # minimum cosine similarity to report a pair
max_pairs = 50                  # cap on reported pairs, highest score first

[half_life]                     # the ranking factor that fades stale docs (spec/50)
default = 0                     # days; 0 = nothing fades
[half_life.folders]             # folder → days, longest matching prefix wins;
                                # the frontmatter `half_life` of a doc beats both
# journals = 30
# skills = 0

[ui]                            # presentation policy shipped to the client (spec/50 /api/status)
max_nodes_mobile = 8000         # node cap the web UI applies on mobile/weak GPUs
default_mode = "cosmos"         # cosmos | brain — the view the UI opens in

[serve]
host = "127.0.0.1"
port = 4747
transports = ["streamable-http"]   # + "sse" for the legacy transport
watch = true
writes = "guarded"              # guarded | off
token = ""                      # required for non-localhost binds
max_asset_bytes = 8388608       # 8 MiB — POST /api/assets upload cap (spec/50)

[validate]
henxels = "auto"                # auto | always | never

[update]                        # the proactive new-version notice (spec/20, spec/70)
check = true                    # false: never touch the network for a version check

[brain]                         # present only on a brain, not a plain wiki (spec/85)
format = 0                      # brain-format version; 0 = not a brain
origin = ""                     # canonical git URL — a lookup key, never the identity
audience = "personal"           # personal | team | public — unknown values warn → personal
readers = []                    # for team: the assumed readers, by handle or role
```

Unknown keys are warnings, not errors (config written by a newer brainpick
must not brick an older one). `[half_life.folders]` keys are bundle-relative
folder paths without a trailing slash (`journals`, `journals/archive`);
values are days, a non-number is ignored. `BRAINPICK_HALF_LIFE_DEFAULT`
overrides the scalar; `BRAINPICK_HALF_LIFE_FOLDERS` takes
`folder=days,folder=days`. `[brain]` is defined in spec/85; all of its
keys are optional and `BRAINPICK_BRAIN_*` env overrides apply to the
scalars.

## `[update] check` — the new-version notice

Agents never check for updates; the brain tells them. When `check` is true
(default), `compile` and `serve` look up the latest published version of
the running engine — PyPI's `https://pypi.org/pypi/brainpick/json` for the
Python engine, npm's `https://registry.npmjs.org/brainpick/latest` for the
Node engine — at most **once per 24 h**, with the probe timeout of spec/30
(≤ 300 ms, a miss is silent), and cache the answer in
`~/.cache/brainpick/latest.json` as `{"impl", "checked_at", "latest"}`.
The lookup never blocks, never fails a compile, and never runs in tests
(`BRAINPICK_UPDATE_CHECK=false`, the env override of this key, is the
switch; CI sets it). What it leaks is one HTTPS request to the registry per
day; `check = false` in `brainpick.local.toml` keeps an air-gapped or
private machine silent for good.

The result is a **notice**: `{"current", "latest", "hint"}`, present only
when `latest` is known AND newer than `current` (semantic-version
comparison on the `MAJOR.MINOR.PATCH` core; pre-release tags never count as
newer). Where it surfaces is normative so every harness sees it without
asking: the AGENTS.md report block (spec/20), `brain_overview` (spec/70),
and one line on `compile` output. `hint` is the exact upgrade command for
the engine that noticed: `pip install -U brainpick` or
`npm install -g brainpick`.

## The release ledger and the what's-new notice

The update notice says *a newer engine exists*; the what's-new notice says
*what changed, and what to do about it*. Both engines ship the same
**release ledger**, `spec/releases.yaml` (canonical; copied byte-identical
into each package the way the Agent Skill is — `scripts/sync-releases.mjs`,
parity-tested). It is structured so an agent never has to read a
changelog:

```yaml
releases:
  - version: 0.6.0          # newest first; the head may be `date: unreleased`
    date: 2026-09-13        # ISO date, or the word `unreleased`
    brain_format: 2         # the brain format this engine writes (spec/85)
    summary: one line an agent can act on
    changes:
      - kind: added         # added | changed | fixed | removed
        area: brain         # brain | cli | mcp | search | config | compile | webui | docs
        text: what changed, in one or two sentences
        agent_action: what an agent should do about it   # optional, imperative
```

`version` is the package version (pip and npm are lockstep); the head
entry must equal the package version, or be marked `unreleased` and be
newer than it — the release workflow checks. `brain_format` is per entry
so the ledger tells when the format moved.

**The notice.** Given the ledger, the running engine's `current` version,
`since` (the `generator.version` of the manifest the compile started from
— the version that *last compiled this brain* — or `null` when there was
no manifest) and the brain's stamped `[brain] format` (`null` when not a
brain), `whats_new(ledger, current, since, format)` yields `null` or

```json
{"since": "0.5.0", "current": "0.6.0", "releases": ["0.6.0"],
 "format": {"current": 1, "latest": 2}, "hint": "…"}
```

- `releases`: the ledger versions `v` with `since < v ≤ current` (semantic
  comparison on the `MAJOR.MINOR.PATCH` core, spec/80 `[update] check`),
  newest first; `[]` when `since` is `null` or nothing lies between. Key
  omitted, not `[]`, when empty. `since` is omitted when `null`. An
  `unreleased` head is never listed: nothing has been released that one
  could have missed.
- `format`: present only when the bundle is a brain and its stamp is below
  the newest `brain_format` among ledger entries ≤ `current` **or marked
  `unreleased`** — the format a dev checkout's head declares is the one
  that checkout writes (its `migrate` already knows it). A released
  package never ships an unreleased head (the parity test and the release
  workflow both check), so for it the two rules coincide.
- `hint`: the parts joined by `; `, in this order, exactly: for releases
  `brainpick <since> → <current>: <n> release(s) since this brain was last
  compiled — run \`brainpick whats-new --since <since>\``; for the format
  `brain format <current> → <latest>: run \`brainpick migrate --to
  <latest>\``.
- `null` when neither part applies — a brain compiled by this very
  version at the current format has nothing to hear.

Where it surfaces is normative, the same three places as the update
notice: `compile` prints `note: what's new — <hint>`; the AGENTS.md report
carries `- What's new: <hint>` after the bundle-root line (and after the
`Engine:` line when both exist; outside the golden, since it depends on
the installed version); `brain_overview` carries `whats_new` (the object
above) and its `hint` starts with `What's new — <hint>. ` (after the
update notice's prefix when both exist). A compile that rewrites the
manifest stamps the current version into it, so the *release* part clears
itself on the next compile that changes anything — the hint therefore
names `--since`, so the agent can still ask for the full text afterwards.
The *format* part stays until the brain is migrated.

`brainpick whats-new [--since V] [--all] [--json]` prints the ledger
entries the notice points at — summary, changes, and every
`agent_action` collected under **Do next** — for `since` = `--since`, else
the manifest's `generator.version`, else the current version alone (the
running engine's own notes: always something useful, never "nothing").
`--all` prints the whole ledger; `--json` the raw entries plus the notice.

**Do next is a checklist**, not a list: its items are numbered `1.`, `2.`,
… in the order they should be done — the actions of the *oldest* shown
release first (an agent that missed three releases catches up in the order
they happened), each release's actions in ledger order, and the format
part (`brain format <c> → <l>: run \`brainpick migrate --to <l>\``) last
when it applies. Ledger authors therefore order a release's `changes` so
its `agent_action`s read as an upgrade path: the engine and the brain's
bytes first (upgrade, migrate), then the wiring that makes the brain shared
(integrate, register), then habits. An `agent_action` that names a command
names it in backticks and exactly as it is typed.

Conformance (class `whats-new`): a fixture ledger under
`spec/fixtures/releases/` and cases giving `current`, `since`, `format`
and the exact expected notice — both engines natively.

## `[bundle] id` — brain identity

A random opaque identifier minted by `brainpick init` (recommended shape:
21-char nanoid-style `[a-z0-9]`) and committed with the bundle in
`brainpick.toml` — it is SHARED config, not machine-local, because the
identity travels with the bundle wherever it is cloned or served. Consumers
treat it as an address (multi-brain serving, the desktop app's brain
registry, the federation registry's `id` — spec/75), never as a credential —
it grants no access on its own. Absent on bundles that predate this key.
`brainpick init` mints one in every config it CREATES; on a bundle whose
`brainpick.toml` already exists without an id, init OFFERS a paste-able
fragment instead of editing in place (init never rewrites a config it did
not create — the same contract as its henxels fragment). Either way,
re-running `init` never mints a second id. `GET /api/status` ships it as
`id` (spec/50), `null` when the bundle has none.

## Layering: shared vs machine-local

`brainpick.toml` is SHARED, versioned, for-everyone bundle policy (index
mode, module switches) and must never carry personal endpoints — a public
bundle's readers do not share your LAN. A `brainpick.local.toml` beside it
holds MACHINE-LOCAL values (model endpoints, tokens-by-reference) and
deep-merges over the shared file; `brainpick init` writes detected
endpoints THERE and adds it to `.gitignore`. Precedence: CLI flags > env
(`BRAINPICK_*`) > `brainpick.local.toml` > `brainpick.toml` > defaults.
An unparseable local layer is warned about and ignored — the shared file
still applies.

## Auth (optional — open by default)

Secrets never live in config or `.brainpick/` (artifacts are disposable;
henxels hunts secrets). They live in `.brainpick-auth.json` at the bundle
root — gitignored by the commands that create it, salted hashes only:

```json
{"version": 1,
 "password": {"algo": "scrypt", "salt": "<hex16>", "hash": "<hex32>"},
 "tokens": [{"id": "tk_…", "name": "hermes", "algo": "scrypt",
             "salt": "<hex16>", "hash": "<hex32>", "created": "<iso>"}],
 "session_secret": "<hex32>"}
```

scrypt N=16384 r=8 p=1, 32-byte key, 16-byte salt — identical in both
engines. CLI: `brainpick token create [--name]` (prints the token ONCE),
`token list` (never secrets), `token revoke <id>`, `brainpick password
set` (TTY prompt or `--stdin`), `password clear`.

Enforcement (spec/50 carries the shapes): with NO auth file, everything is
open (today's behavior; non-localhost binds still demand `[serve] token` —
superseded by real tokens once any exist). Once tokens or a password
exist: `/api/*` and `/mcp` require a valid `Authorization: Bearer <token>`
OR a valid session cookie; `/api/live` additionally accepts `?token=`
(EventSource cannot set headers); the static UI (`/`) requires a session
only when a password is set (login page → `POST /api/login {password}` →
HMAC-signed cookie from `session_secret`, `/api/logout` clears). stdio MCP
is never gated — it is local by construction. Tokenless + passwordless
stays a first-class setup.

Edge semantics: the enforcement trigger is CREDENTIALS EXISTING, not the
file — revoking the last token with no password set reopens the brain,
and an empty auth file is open. A CORRUPT auth file fails CLOSED (every
gated request 401s; doctor explains the fix) — never silently open.
Session cookie internals (both engines identical): value
`<unix-expiry>.<hmac-sha256-hex>` with key = hex-decoded `session_secret`
over the decimal expiry string; `Max-Age=43200; Path=/; HttpOnly;
SameSite=Lax`. `POST /api/login` with no password configured → 400 with
the enabling instruction.

## Model sections

`[models.embedding]` (T2 — spec/30: kind, endpoint, model, `timeout` in
whole seconds per batch, default 1800) and
`[models.extraction]` (kind = `ollama | openai-compatible`, endpoint,
model, `api_key_env` naming an env var, never a key) — the extraction
model powers T3 and doubles as the merge resolver (spec/70 brain_write).
