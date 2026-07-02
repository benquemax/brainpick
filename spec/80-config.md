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
must not brick an older one). `[models.*]` sections are specified with T2
(M2).
