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

[index]
mode = "section"                # manage | section | off
file = "index.md"

[modules]                       # T1 has no switch
vectors = "auto"                # auto | on | off   (T2 — M2)
graph = "algorithmic"           # algorithmic (default) | lightrag | auto | off
                                # auto = lightrag when [models.extraction] is
                                # configured, else algorithmic (spec/40)
ui = true

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
```

Unknown keys are warnings, not errors (config written by a newer brainpick
must not brick an older one).

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

`[models.embedding]` (T2 — spec/30: kind, endpoint, model) and
`[models.extraction]` (kind = `ollama | openai-compatible`, endpoint,
model, `api_key_env` naming an env var, never a key) — the extraction
model powers T3 and doubles as the merge resolver (spec/70 brain_write).
