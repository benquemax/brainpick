"""`brainpick init` and `brainpick doctor` (docs/onboarding.md): detect, propose,
compile, glow — and never interrogate.

Henxels-family voice: a box banner and colors on a TTY, plain lines in pipes, and
every error is an instruction. init never rewrites what it does not own — existing
configs, .gitignore, and henxels.yaml get paste-able fragments, not edits. The one
exception is the `.brainpick-auth.json` gitignore line (spec/80): secrets must never
enter git, so init appends it itself, exactly like the auth commands do.
"""
from __future__ import annotations

import json
import os
import sys
import warnings
from pathlib import Path
from typing import Mapping

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10
    import tomli as tomllib

from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.config import LOCAL_CONFIG_FILE, config_layers, load_config
from brainpick.vectorstore import lancedb_available
from brainpick.detect import (
    Backend,
    BundleInfo,
    detect_bundle,
    detect_henxels,
    detect_link_style,
    find_repo_root,
    henxels_on_path,
    openai_key_present,
    probe_backends,
)

_RESET = "\033[0m"
_GREEN = "\033[32m"
_RED = "\033[31m"
_CYAN = "\033[36m"
_DIM = "\033[2m"

BANNER = r"""   ╭──────────────────╮
   │    ◉ ─── ◉       │   brainpick
   │     ╲   ╱        │   pick your agent's brain
   │  ◉ ─── ◉ ─── ◉   │   compile · serve · glow
   ╰──────────────────╯"""

OPENAI_ENDPOINT = "https://api.openai.com/v1"
OPENAI_DEFAULT_MODEL = "text-embedding-3-small"
PULL_HINT = "ollama pull nomic-embed-text"

_CONFIG_TEMPLATE = """\
# brainpick.toml — written by `brainpick init`; every key is optional (spec 0.1).
# SHARED bundle policy, safe to commit. Machine-local values (model endpoints,
# tokens) belong in brainpick.local.toml beside it — deep-merged over this file.
# Env overrides: BRAINPICK_<SECTION>_<KEY>. CLI flags override both.
spec = "0.1"

[bundle]
root = "."                        # the bundle lives right here
include = ["**/*.md"]
exclude = []                      # .brainpick/, .git/, _temp/, node_modules/ always excluded

[index]
mode = "section"                  # manage | section | off — how index.md is maintained
file = "index.md"

[modules]                         # T1 always compiles; the deeper tiers are switchable
vectors = "auto"                  # auto | on | off — T2 semantic search (embedding backend required)
graph = "algorithmic"             # algorithmic (default) | lightrag | auto | off — T3 entity graph
ui = true

[serve]
host = "127.0.0.1"
port = 4747
transports = ["streamable-http"]  # add "sse" for the legacy transport
watch = true                      # recompile when bundle files change
writes = "guarded"                # guarded | off — agent writes are validated, never blind
token = ""                        # required for non-localhost binds

[validate]
henxels = "auto"                  # auto | always | never — honor a henxels contract when present
"""

_LOCAL_CONFIG_TEMPLATE = """\
# brainpick.local.toml — written by `brainpick init`; MACHINE-LOCAL values only.
# Deep-merges over the shared brainpick.toml. Keep it out of version control —
# a public bundle's readers do not share your LAN.

[models.embedding]                # detected at init; T2 embeds with it
kind = "{kind}"
endpoint = "{endpoint}"
model = "{model}"
"""

GITIGNORE_LINES = (".brainpick/", "brainpick.local.toml")


def is_fancy(stream=None, env: Mapping[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    if env.get("NO_COLOR") or env.get("CI") or env.get("BRAINPICK_PLAIN"):
        return False
    stream = sys.stdout if stream is None else stream
    return bool(getattr(stream, "isatty", lambda: False)())


class _Voice:
    """✓/○/✗ lines — colored on a TTY, identical but plain in pipes."""

    def __init__(self, env: Mapping[str, str]):
        self.fancy = is_fancy(env=env)

    def _c(self, text: str, code: str) -> str:
        return f"{code}{text}{_RESET}" if self.fancy else text

    def banner(self) -> None:
        if self.fancy:
            print(self._c(BANNER, _CYAN))
            print()

    def line(self, mark: str, text: str) -> None:
        color = {"✓": _GREEN, "✗": _RED, "○": _DIM}.get(mark, "")
        print(f"{self._c(mark, color)} {text}")

    def arrow(self, text: str) -> None:
        print(f"    {self._c('→ ' + text, _CYAN)}")

    def step(self, text: str) -> None:
        print(f"    {text}")

    def raw(self, text: str = "") -> None:
        print(text)


# -- paths and paste-ables ---------------------------------------------------------


def _package_project_dir() -> Path | None:
    """This checkout's packages/python — present in dev, absent in installed wheels."""
    project = Path(__file__).resolve().parents[2]
    return project if (project / "pyproject.toml").is_file() else None


def brainpick_command() -> list[str]:
    """A brainpick invocation that works from anywhere, for this installation."""
    project = _package_project_dir()
    if project is not None:
        return ["uv", "run", "--project", str(project), "brainpick"]
    return ["uvx", "brainpick"]  # published: uvx resolves it from the index


def render_config() -> str:
    """The shared brainpick.toml — bundle policy only, endpoint-free by design."""
    return _CONFIG_TEMPLATE


def render_local_config(backend: Backend) -> str:
    """The machine-local brainpick.local.toml carrying the detected endpoint."""
    return _LOCAL_CONFIG_TEMPLATE.format(
        kind=backend.kind, endpoint=backend.endpoint, model=backend.model,
    )


def _indent(text: str, prefix: str = "    ") -> str:
    return "\n".join(prefix + line for line in text.splitlines())


def mcp_snippets(bundle: Path) -> str:
    command = brainpick_command() + ["mcp", "--root", str(bundle)]
    generic = {"mcpServers": {"brainpick": {"command": command[0], "args": command[1:]}}}
    opencode = {"mcp": {"brainpick": {"type": "local", "command": command, "enabled": True}}}
    parts = [
        "Hand these keys to your agents:",
        "",
        "  Claude Code",
        f"    claude mcp add brainpick -- {' '.join(command)}",
        "",
        "  any MCP host (stdio JSON)",
        _indent(json.dumps(generic, indent=2)),
        "",
        "  opencode (opencode.json)",
        _indent(json.dumps(opencode, indent=2)),
    ]
    if _package_project_dir() is not None:
        parts += ["", f"  ○ once published this shrinks to: uvx brainpick mcp --root {bundle}"]
    return "\n".join(parts)


def henxels_fragment(contract: Path, bundle: Path) -> str:
    """The freshness gate, paste-able into an existing contract — never applied for you."""
    root = os.path.relpath(bundle, contract.parent)
    command = " ".join(brainpick_command() + ["compile", "--check-fresh", "--root", root])
    return (
        '  - henxel: "The compiled brain is fresh before every commit"\n'
        "    why: agents navigate the compiled artifacts — stale artifacts lie to them\n"
        f'    run_before_commit: "{command}"'
    )


def gitignore_suggestion(bundle: Path) -> tuple[Path, list[str]] | None:
    """The repo .gitignore and the lines it should learn — `.brainpick/` (disposable
    artifacts) and `brainpick.local.toml` (personal endpoints). None if covered/absent."""
    repo = find_repo_root(bundle)
    if repo is None:
        return None
    gitignore = repo / ".gitignore"
    if not gitignore.is_file():
        return None
    text = gitignore.read_text(encoding="utf-8", errors="replace")
    missing = [line for line in GITIGNORE_LINES if line.rstrip("/") not in text]
    if not missing:
        return None
    return gitignore, missing


# -- init --------------------------------------------------------------------------


def _hand_off_to_henxels(voice: _Voice, root: Path, bundle: BundleInfo) -> int:
    if bundle.docs == 0:
        voice.line("✗", f"no bundle at {root} — the directory holds no markdown yet")
    else:
        voice.line("✗", f"no bundle at {root} — {bundle.docs} .md files but only {bundle.typed} "
                        "carry OKF `type:` frontmatter (3+ needed, or an index.md with okf_version)")
    voice.step("brainpick never scaffolds wikis — its sibling henxels owns the template:")
    voice.step("  uv tool install henxels")
    voice.step(f"  cd {root} && henxels init --template okf-llm-wiki --wiki-dir .")
    voice.step(f"then come back: brainpick init --root {root}")
    return 1


def _report_backends(
    voice: _Voice, results: list[tuple[str, Backend | None]],
    env: Mapping[str, str], yes: bool,
) -> Backend | None:
    """Print the probe verdicts; return the backend worth recording (or None)."""
    found = next(
        ((label, b) for label, b in results if b is not None and b.model is not None), None,
    )
    if found is not None:
        label, backend = found
        voice.line("✓", f"embeddings: {backend.model} via {label} at {backend.endpoint}"
                        " — T2 embeds with it on the next compile")
        return backend

    ollama = next((b for label, b in results if label == "ollama" and b is not None), None)
    if ollama is not None:  # up, but modelless — offer the exact pull
        voice.line("○", f"embeddings: ollama is up at {ollama.endpoint} but has no embedding model")
        voice.arrow(f"{PULL_HINT}  (then rerun brainpick init)")
    else:
        voice.line("○", "embeddings: no local backend found — T1 shines without one")
        voice.arrow(f"light it up later: {PULL_HINT}  (then rerun brainpick init)")

    if openai_key_present(env):
        if yes:
            voice.line("✓", f"embeddings: OPENAI_API_KEY accepted (--yes) — recording "
                            f"{OPENAI_DEFAULT_MODEL} for T2")
            return Backend("openai", OPENAI_ENDPOINT, OPENAI_DEFAULT_MODEL)
        voice.line("○", "OPENAI_API_KEY detected — a paid API stays opt-in (local-first):"
                        " rerun with --yes to record it")
    return None


def run_init(
    root: str | Path,
    yes: bool = False,
    dry_run: bool = False,
    env: Mapping[str, str] | None = None,
    probes: list[tuple[str, Backend | None]] | None = None,
) -> int:
    env = os.environ if env is None else env
    voice = _Voice(env)
    voice.banner()

    root = Path(root)
    if not root.is_dir():
        voice.line("✗", f"{root} is not a directory")
        voice.arrow(f"create it (mkdir -p {root}) or point --root at your bundle")
        return 1
    root = root.resolve()

    # 1 — the bundle
    bundle = detect_bundle(root)
    if bundle.kind == "none":
        return _hand_off_to_henxels(voice, root, bundle)
    if bundle.kind == "okf":
        voice.line("✓", f"bundle: OKF at {root} — index.md declares okf_version ({bundle.docs} docs)")
    else:
        voice.line("✓", f"bundle: {bundle.typed} typed concept docs at {root} (density scan)")

    # 2 — link style (informational in 0.1)
    style = detect_link_style(root)
    if style.style == "none":
        voice.line("○", "links: none yet — write [title](path.md) links and the graph appears")
    else:
        voice.line("○", f"links: {style.style} style ({style.markdown} markdown · "
                        f"{style.wikilinks} wikilinks)")

    # 3 — backends (parallel 300 ms probes; failures are silent misses)
    results = probe_backends(env) if probes is None else probes
    backend = _report_backends(voice, results, env, yes)

    # 4 — henxels
    contract = detect_henxels(root)
    if contract is not None:
        voice.line("✓", f"henxels: contract at {contract} — freshness gate offered below")
    else:
        voice.line("○", "henxels: no contract governs this bundle (optional) — uv tool install henxels")

    if dry_run:
        voice.raw()
        voice.raw("dry run — nothing written. init would:")
        if (root / "brainpick.toml").exists():
            voice.step("• keep the existing brainpick.toml (never rewritten)")
        else:
            voice.step("• write brainpick.toml at the bundle root (shared policy, endpoint-free)")
        if backend is not None:
            if (root / "brainpick.local.toml").exists():
                voice.step("• keep the existing brainpick.local.toml (never rewritten)")
            else:
                voice.step("• write brainpick.local.toml recording the detected embedding backend")
        voice.step("• compile T1 into .brainpick/ and manage the index.md section")
        voice.step("• print the MCP snippets and the serve command")
        return 0

    # 5 — config (written once; an existing config is the user's, not ours).
    # Shared policy and machine-local endpoints are separate layers (spec/80).
    config_path = root / "brainpick.toml"
    if config_path.exists():
        voice.line("○", "config: brainpick.toml exists — left untouched")
    else:
        config_path.write_text(render_config(), encoding="utf-8")
        voice.line("✓", "config: brainpick.toml written (shared policy — endpoints stay local)")

    if backend is not None:
        local_path = root / "brainpick.local.toml"
        if local_path.exists():
            voice.line("○", "config: brainpick.local.toml exists — left untouched")
            voice.step(f'pin the detected backend yourself: [models.embedding] '
                       f'kind = "{backend.kind}", model = "{backend.model}"')
        else:
            local_path.write_text(render_local_config(backend), encoding="utf-8")
            voice.line("✓", "config: brainpick.local.toml written ([models.embedding] recorded)")

    suggestion = gitignore_suggestion(root)
    if suggestion is not None:
        gitignore, missing = suggestion
        voice.line("○", f"artifacts are disposable, endpoints personal — add to {gitignore} yourself:")
        for line in missing:
            voice.step(line)

    # spec/80: secrets must never enter git — the auth commands append this line
    # themselves, and init pre-teaches it (the one .gitignore edit init makes).
    from brainpick.auth import AUTH_FILE, ensure_gitignored

    ignored = ensure_gitignored(root)
    if ignored is not None:
        voice.line("✓", f"gitignore: {AUTH_FILE} added to {ignored} (secrets stay off the record)")

    # 6 — compile T1
    result = run_compile(root)
    stats = result.stats
    voice.line("✓", f"compiled: {stats['docs']} docs · {stats['edges']} links · "
                    f"{stats['orphans']} orphans — your brain, compiled")

    # 7 — hand out the keys
    voice.raw()
    voice.raw(mcp_snippets(root))

    # 8 — the henxels freshness gate
    if contract is not None:
        voice.raw()
        voice.raw(f"Gate commits on a fresh brain — paste into {contract}:")
        voice.raw()
        voice.raw(henxels_fragment(contract, root))

    # 9 — glow
    serve = " ".join(brainpick_command() + ["serve", "--root", str(root), "--open"])
    voice.raw()
    voice.raw(f"Serve the brain: {serve}")
    return 0


# -- doctor ------------------------------------------------------------------------


def run_doctor(
    root: str | Path,
    env: Mapping[str, str] | None = None,
    probes: list[tuple[str, Backend | None]] | None = None,
) -> int:
    env = os.environ if env is None else env
    voice = _Voice(env)
    root = Path(root).resolve()
    failed = False

    def emit(mark: str, text: str, fix: str | None = None) -> None:
        nonlocal failed
        voice.line(mark, text)
        if fix:
            voice.arrow(fix)
        if mark == "✗":
            failed = True

    # config layers parse (or defaults) — spec/80: shared file + machine-local overlay
    layers = config_layers(root)
    if not layers:
        emit("✓", "config: none — defaults apply (a bundle needs zero config)")
    for config_path in layers:
        note = " (machine-local layer)" if config_path.name == LOCAL_CONFIG_FILE else ""
        try:
            tomllib.loads(config_path.read_text(encoding="utf-8"))
            emit("✓", f"config: {config_path.name} parses{note}")
        except tomllib.TOMLDecodeError as error:
            emit("✗", f"config: {config_path.name} is not valid TOML ({error})",
                 f"fix the syntax in {config_path} — the engine skips this layer meanwhile")

    # bundle
    bundle = detect_bundle(root) if root.is_dir() else BundleInfo("none", 0, 0)
    if bundle.kind == "okf":
        emit("✓", f"bundle: OKF ({bundle.docs} docs)")
    elif bundle.kind == "density":
        emit("✓", f"bundle: {bundle.typed} typed concept docs of {bundle.docs} (density scan)")
    else:
        emit("✗", f"bundle: nothing OKF-shaped at {root}",
             f"cd {root} && henxels init --template okf-llm-wiki --wiki-dir .")

    # artifacts
    verdict = check_fresh(root)
    if verdict.fresh:
        manifest = json.loads((root / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))
        emit("✓", f"artifacts: fresh (seq {manifest['seq']})")
    else:
        reason = verdict.reason.split(" — ")[0]
        emit("✗", f"artifacts: {reason}", f"run: brainpick compile --root {root}")

    # auth (spec/80): optional, open by default — stdio MCP is never gated either way
    from brainpick.auth import AUTH_FILE, auth_active, load_auth

    try:
        auth_store = load_auth(root)
    except ValueError:
        emit("✗", f"auth: {AUTH_FILE} is not valid JSON",
             "fix or delete it — the server fails closed meanwhile")
    else:
        if auth_active(auth_store):
            count = len(auth_store.tokens)
            plural = "" if count == 1 else "s"
            password = "set" if auth_store.password is not None else "absent"
            emit("✓", f"auth: {count} token{plural} · password {password} — stdio MCP stays ungated")
        else:
            emit("○", "auth: open — no auth configured (brainpick token create / password set lock it)")

    # T2 vectors: extra installed, backend configured, tier state (spec/30) — optional, never ✗
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # config problems already have their own line above
        embedding = load_config(root).models.embedding
    tiers = {}
    manifest_path = root / ".brainpick" / "manifest.json"
    if manifest_path.is_file():
        try:
            tiers = json.loads(manifest_path.read_text(encoding="utf-8")).get("tiers", {})
        except ValueError:
            tiers = {}
    t2_state = tiers.get("t2", "off")
    if not embedding.kind:
        emit("○", "vectors: no [models.embedding] configured — brainpick init detects backends")
    elif not lancedb_available():
        emit("○", "vectors: lancedb missing — pip install 'brainpick[vectors]'")
    elif t2_state == "fresh":
        model = f" · {embedding.model}" if embedding.model else ""
        emit("✓", f"vectors: t2 fresh — {embedding.kind}{model}")
    else:
        emit("○", f"vectors: configured ({embedding.kind}) but t2 is {t2_state}",
             f"run: brainpick compile --root {root}")

    # T3 graph: which backend the config resolves to, its prerequisites, tier state
    # (spec/40) — optional, never ✗. The algorithmic default derives the graph from
    # ghosts and tags with no model; lightrag (LLM extraction) is the opt-in.
    from brainpick.config import resolve_graph_backend
    from brainpick.kgadapt.lightrag_backend import lightrag_available

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        graph_config = load_config(root)
    extraction = graph_config.models.extraction
    backend = resolve_graph_backend(graph_config)
    t3_state = tiers.get("t3", "off")
    if backend == "off":
        emit("○", 'graph: off by config — set [modules] graph = "algorithmic" to derive it')
    elif backend == "lightrag" and not extraction.kind:
        emit("○", 'graph: [modules] graph = "lightrag" but no [models.extraction] —'
                  " set a chat model in brainpick.local.toml")
    elif backend == "lightrag" and extraction.kind != "mock" and not lightrag_available():
        emit("○", "graph: LightRAG missing — pip install 'brainpick[graph]'")
    elif t3_state == "fresh":
        detail = "derived from ghosts + tags, no model needed" if backend == "algorithmic" \
            else f"{extraction.kind}" + (f" · {extraction.model}" if extraction.model else "")
        emit("✓", f"graph: t3 fresh — {detail}")
    else:
        emit("○", f"graph: {backend} configured but t3 is {t3_state}",
             f"run: brainpick compile --only t3 --root {root}")

    # backend probes
    results = probe_backends(env) if probes is None else probes
    for label, backend in results:
        if backend is None:
            emit("○", f"{label}: not reachable")
        elif backend.model is None:
            hint = f" — {PULL_HINT}" if label == "ollama" else ""
            emit("○", f"{label}: up at {backend.endpoint}, no embedding model{hint}")
        else:
            emit("✓", f"{label}: {backend.model} at {backend.endpoint}")
    if openai_key_present(env):
        emit("○", "OPENAI_API_KEY: set — a paid API stays opt-in (brainpick init --yes records it)")
    else:
        emit("○", "OPENAI_API_KEY: not set")

    # henxels
    on_path = henxels_on_path()
    contract = detect_henxels(root)
    if on_path and contract is not None:
        emit("✓", f"henxels: on PATH · contract at {contract}")
    elif on_path:
        emit("○", f"henxels: on PATH · no contract governs {root}")
    elif contract is not None:
        emit("○", f"henxels: contract at {contract} but the CLI is missing — uv tool install henxels")
    else:
        emit("○", "henxels: not installed (optional) — uv tool install henxels")

    # UI assets
    from brainpick.serve.app import _resolve_ui_dir

    ui_dir = _resolve_ui_dir()
    if ui_dir is not None:
        emit("✓", f"ui: {ui_dir}")
    else:
        emit("○", "ui: not built — the fallback page serves; build once:"
                  " cd packages/webui && npm run build")

    # the node sibling engine
    project = _package_project_dir()
    node_pkg = project.parent / "node" / "package.json" if project is not None else None
    if node_pkg is not None and node_pkg.is_file():
        emit("✓", f"node engine: {node_pkg.parent}")
    else:
        emit("○", "node engine: npm engine arrives in M2")

    return 1 if failed else 0
