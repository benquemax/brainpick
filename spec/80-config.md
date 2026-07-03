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
graph = "off"                   # auto | on | off   (T3 — M3)
ui = true

[serve]
host = "127.0.0.1"
port = 4747
transports = ["streamable-http"]   # + "sse" for the legacy transport
watch = true
writes = "guarded"              # guarded | off
token = ""                      # required for non-localhost binds

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

## Model sections

`[models.embedding]` (T2 — spec/30: kind, endpoint, model) and
`[models.extraction]` (kind = `ollama | openai-compatible`, endpoint,
model, `api_key_env` naming an env var, never a key) — the extraction
model powers T3 and doubles as the merge resolver (spec/70 brain_write).
