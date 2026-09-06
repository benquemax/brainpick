"""Federation (spec/75): many brains behind one MCP server.

A BrainSet is an ordered list of Brains — {alias, root, role, here} — assembled
from explicit --root flags or the shared registry (brains.toml) ∪ the working
directory's own bundle. Brains load lazily into ServeStates; the MCP payload
builders in mcp_server accept a BrainSet in place of a ServeState and fan out,
merge and qualify (alias:path) when the set holds more than one brain.
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - exercised only on 3.10
    import tomli as tomllib

from brainpick.compile.pipeline import _atomic_write

RESERVED_ALIASES = ("all", "here", "me")
_SLUG = re.compile(r"[^a-z0-9]+")
_QUALIFIED = re.compile(r"^([a-z0-9][a-z0-9-]*):(.+)$")
_KEY_ORDER = ("id", "repo", "bundle_path", "port", "enabled", "host", "alias", "role")
DEFAULT_PORT_BASE = 4750  # mirrors the daemon's registry (packages/desktop)
DEFAULT_HOST = "127.0.0.1"


# -- qualified paths -------------------------------------------------------------------


def split_qualified(doc: str) -> tuple[str | None, str]:
    """'alias:path' → (alias, path); a bare path → (None, path). Only a lowercase
    slug before the colon counts, so a Windows drive letter or a stray colon in a
    title never reads as an alias."""
    match = _QUALIFIED.match(str(doc or "").strip())
    if match and "\\" not in match.group(2) and not match.group(2).startswith("//"):
        return match.group(1), match.group(2)
    return None, str(doc or "").strip()


def qualify(alias: str, path: str) -> str:
    return f"{alias}:{path}"


# -- aliases ---------------------------------------------------------------------------


def slugify_alias(text: str) -> str:
    slug = _SLUG.sub("-", str(text).lower()).strip("-")
    return slug or "brain"


def alias_for(root: str | Path) -> str:
    """The default alias: the git repo's name when the bundle sits in one, else the
    bundle directory's own name (spec/75)."""
    from brainpick.detect import find_repo_root

    root = Path(root).resolve()
    repo = find_repo_root(root)
    return slugify_alias((repo or root).name)


def alias_for_repo(repo: str) -> str:
    """The alias of a registry `repo` value — a local path's repo name, or a remote
    URL's basename without `.git`."""
    if is_local_repo(repo):
        return alias_for(repo)
    tail = repo.rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]
    return slugify_alias(tail[:-4] if tail.endswith(".git") else tail)


def dedupe_aliases(wanted: Iterable[str | None], roots: Iterable[Path]) -> list[str]:
    """Reserved words and collisions take -2, -3, … in set order — deterministic."""
    taken: set[str] = set(RESERVED_ALIASES)
    result: list[str] = []
    for want, root in zip(wanted, roots):
        base = slugify_alias(want) if want else alias_for(root)
        alias, n = base, 1
        while alias in taken:
            n += 1
            alias = f"{base}-{n}"
        taken.add(alias)
        result.append(alias)
    return result


# -- the registry ----------------------------------------------------------------------


def is_local_repo(repo: str) -> bool:
    """A local path, as opposed to a git remote (scheme:// or scp-like user@host:)."""
    if re.match(r"^[a-z][a-z0-9+.-]*://", repo, re.IGNORECASE):
        return False
    if re.match(r"^[^/\s]+@[^/\s]+:", repo):
        return False
    return True


def registry_path(env: dict | None = None) -> Path:
    """~/.config/brainpick/brains.toml, XDG-aware; BRAINPICK_REGISTRY overrides the
    file path outright (tests, isolated setups)."""
    env = os.environ if env is None else env
    override = env.get("BRAINPICK_REGISTRY")
    if override:
        return Path(override)
    daemon_dir = env.get("BRAINPICK_DAEMON_CONFIG_DIR")
    if daemon_dir:
        return Path(daemon_dir) / "brains.toml"
    xdg = env.get("XDG_CONFIG_HOME") or str(Path(env.get("HOME", "~")).expanduser() / ".config")
    return Path(xdg) / "brainpick" / "brains.toml"


def data_dir(env: dict | None = None) -> Path:
    env = os.environ if env is None else env
    override = env.get("BRAINPICK_DAEMON_DATA_DIR")
    if override:
        return Path(override)
    xdg = env.get("XDG_DATA_HOME") or str(Path(env.get("HOME", "~")).expanduser() / ".local" / "share")
    return Path(xdg) / "brainpick"


def _valid_entry(value) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("id"), str) and value["id"] != ""
        and isinstance(value.get("repo"), str) and value["repo"] != ""
        and isinstance(value.get("bundle_path"), str)
        and isinstance(value.get("port"), int) and not isinstance(value["port"], bool) and value["port"] > 0
        and isinstance(value.get("enabled"), bool)
        and isinstance(value.get("host"), str) and value["host"] != ""
    )


def load_registry(path: str | Path | None = None) -> list[dict]:
    """Every well-formed [[brain]] entry, in file order. An absent or unparseable
    file is an empty registry; a malformed entry is dropped, never fatal."""
    path = registry_path() if path is None else Path(path)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return []
    raw = data.get("brain")
    return [dict(e) for e in raw if _valid_entry(e)] if isinstance(raw, list) else []


def _toml_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def _toml_value(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    return _toml_string(str(value))


def render_registry(entries: list[dict]) -> str:
    """Canonical brains.toml: one [[brain]] table per entry, known keys in spec order
    first, unknown keys after (sorted) so a hand edit survives a round trip."""
    tables = []
    for entry in entries:
        lines = ["[[brain]]"]
        for key in _KEY_ORDER:
            if key in entry and entry[key] is not None:
                lines.append(f"{key} = {_toml_value(entry[key])}")
        for key in sorted(k for k in entry if k not in _KEY_ORDER):
            if entry[key] is not None:
                lines.append(f"{key} = {_toml_value(entry[key])}")
        tables.append("\n".join(lines) + "\n")
    return "\n".join(tables)


def save_registry(entries: list[dict], path: str | Path | None = None) -> None:
    path = registry_path() if path is None else Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(path, render_registry(entries).encode("utf-8"))


def entry_root(entry: dict, env: dict | None = None) -> Path | None:
    """Where a registry entry's bundle lives on THIS machine: a local repo directly,
    a remote one from its daemon clone — None when that clone does not exist
    (federation never clones)."""
    repo = entry["repo"]
    base = Path(repo).expanduser() if is_local_repo(repo) else data_dir(env) / "brains" / entry["id"]
    root = base / entry["bundle_path"] if entry.get("bundle_path") else base
    return root.resolve() if root.is_dir() else None


def _split_root(root: Path) -> tuple[str, str]:
    """(repo, bundle_path) for a local bundle — the git repo above it when there is
    one, so the registry entry matches what the daemon would write."""
    from brainpick.detect import find_repo_root

    repo = find_repo_root(root)
    if repo is None or repo == root:
        return str(root), ""
    return str(repo), root.relative_to(repo).as_posix()


def _bundle_id(root: Path) -> str:
    from brainpick.config import generate_bundle_id, load_config

    return load_config(root).bundle.id or generate_bundle_id()


def register_brain(root: str | Path, path: str | Path | None = None, alias: str | None = None,
                   user: bool = False) -> dict:
    """Add the bundle at `root` to the registry (or update its entry in place when the
    same root is already registered). Returns the entry written."""
    root = Path(root).resolve()
    entries = load_registry(path)
    repo, bundle_path = _split_root(root)
    existing = next((e for e in entries if entry_root(e) == root), None)
    used_ports = {e["port"] for e in entries if e is not existing}
    port = existing["port"] if existing else DEFAULT_PORT_BASE
    while port in used_ports:
        port += 1
    entry = dict(existing) if existing else {
        "id": _bundle_id(root), "repo": repo, "bundle_path": bundle_path, "port": port,
        "enabled": True, "host": DEFAULT_HOST,
    }
    if alias:
        entry["alias"] = slugify_alias(alias)
    if user:
        entry["role"] = "user"
        for other in entries:
            if other is not existing and other.get("role") == "user":
                other.pop("role")  # one personal brain — the newest claim wins
    if existing is None:
        entries.append(entry)
    else:
        entries[entries.index(existing)] = entry
    save_registry(entries, path)
    return entry


def unregister_brain(root: str | Path, path: str | Path | None = None) -> bool:
    root = Path(root).resolve()
    entries = load_registry(path)
    kept = [e for e in entries if entry_root(e) != root]
    if len(kept) == len(entries):
        return False
    save_registry(kept, path)
    return True


# -- the brain set ---------------------------------------------------------------------


def is_bundle_root(path: Path) -> bool:
    return (path / "brainpick.toml").is_file() or (path / ".brainpick").is_dir()


def discover_here(cwd: str | Path) -> Path | None:
    """The nearest ancestor-or-self of cwd that is a bundle root (spec/75)."""
    path = Path(cwd).resolve()
    for candidate in (path, *path.parents):
        if is_bundle_root(candidate):
            return candidate
    return None


@dataclass
class Brain:
    alias: str | None
    root: Path
    role: str | None = None
    here: bool = False
    state: object = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self.root = Path(self.root).resolve()

    @property
    def loaded(self) -> bool:
        return self.state is not None


class BrainSet:
    """An ordered set of brains with unique aliases; loads ServeStates lazily."""

    def __init__(self, brains: list[Brain]):
        aliases = dedupe_aliases((b.alias for b in brains), (b.root for b in brains))
        for brain, alias in zip(brains, aliases):
            brain.alias = alias
        self.brains = list(brains)

    @property
    def federated(self) -> bool:
        return len(self.brains) > 1

    @property
    def here(self) -> Brain | None:
        return next((b for b in self.brains if b.here), None)

    @property
    def user(self) -> Brain | None:
        return next((b for b in self.brains if b.role == "user"), None)

    @property
    def focus(self) -> Brain:
        """The brain single-brain-shaped payloads describe: here, else the first."""
        return self.here or self.brains[0]

    def by_alias(self, alias: str) -> Brain | None:
        return next((b for b in self.brains if b.alias == alias), None)

    def state_for(self, brain: Brain):
        """The brain's ServeState — compiled if stale, loaded once, then held."""
        if brain.state is None:
            from brainpick.config import load_config
            from brainpick.serve.state import ServeState

            state = ServeState(brain.root, load_config(brain.root))
            state.load()
            brain.state = state
        return brain.state

    def manifest_of(self, brain: Brain) -> dict:
        """Manifest only — what brain_overview's `brains` needs without loading."""
        import json

        if brain.state is not None:
            return brain.state.manifest
        path = brain.root / ".brainpick" / "manifest.json"
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def resolve(self, doc: str):
        """Route a (possibly qualified) doc to (brain, outcome, payload) — spec/75's
        cross-brain ladder: a qualified doc resolves in its brain only; a bare doc
        in every brain, one hit is a hit, several is a disambiguation, none a miss.
        outcome ∈ ok | ambiguous | miss | unknown_brain. Payloads carry QUALIFIED
        paths when the set is federated."""
        from brainpick.serve.state import resolve_doc, resolve_doc_exact, resolve_doc_fuzzy

        alias, rel = split_qualified(doc)
        if alias is not None:
            brain = self.by_alias(alias)
            if brain is None:
                return None, "unknown_brain", [b.alias for b in self.brains]
            outcome, payload = resolve_doc(self.state_for(brain).records, rel)
            return brain, outcome, self._qualified_payload(brain, outcome, payload)
        if not self.federated:
            brain = self.brains[0]
            outcome, payload = resolve_doc(self.state_for(brain).records, rel)
            return brain, outcome, payload

        # tier by tier across the set: an exact hit anywhere beats a fuzzy title anywhere
        suggestions: list[str] = []
        for tier in (resolve_doc_exact, resolve_doc_fuzzy):
            hits: list[tuple[Brain, dict]] = []
            ambiguous: list[dict] = []
            for brain in self.brains:
                outcome, payload = tier(self.state_for(brain).records, rel)
                if outcome == "ok":
                    hits.append((brain, payload))
                elif outcome == "ambiguous":
                    ambiguous += [{"path": qualify(brain.alias, r["path"]), "title": r["title"]}
                                  for r in payload]
                else:
                    suggestions += [qualify(brain.alias, p) for p in payload]
            if len(hits) == 1 and not ambiguous:
                return hits[0][0], "ok", hits[0][1]
            if hits or ambiguous:
                listed = [{"path": qualify(b.alias, r["path"]), "title": r["title"]} for b, r in hits]
                return None, "ambiguous", listed + ambiguous
        return None, "miss", suggestions[:5]

    def _qualified_payload(self, brain: Brain, outcome: str, payload):
        if not self.federated or outcome == "ok":
            return payload
        if outcome == "ambiguous":
            return [{"path": qualify(brain.alias, r["path"]), "title": r["title"]} for r in payload]
        return [qualify(brain.alias, p) for p in payload]


def _parse_root_arg(arg: str) -> tuple[str | None, Path]:
    """`ALIAS=PATH` or `PATH` — an alias prefix is a slug followed by '='."""
    match = re.match(r"^([A-Za-z0-9][A-Za-z0-9_-]*)=(.+)$", arg)
    if match:
        return match.group(1), Path(match.group(2))
    return None, Path(arg)


def resolve_brain_set(roots: list[str], cwd: str | Path | None = None,
                      registry_path: str | Path | None = None, env: dict | None = None) -> BrainSet:
    """The spec/75 assembly: explicit roots win outright; else the registry ∪ here,
    ordered here → user → the rest; an empty set is the cwd alone."""
    from brainpick.config import resolve_bundle

    cwd = Path.cwd() if cwd is None else Path(cwd)
    if roots:
        brains = []
        for arg in roots:
            alias, path = _parse_root_arg(arg)
            root, _ = resolve_bundle(cwd / path, env)  # --root may be a repo root above the bundle (spec/80)
            brains.append(Brain(alias=alias, root=root, here=(root == discover_here(cwd))))
        return BrainSet(brains)

    here = discover_here(cwd)
    brains: list[Brain] = []
    for entry in load_registry(registry_path):
        if not entry.get("enabled", True):
            continue
        root = entry_root(entry, env)
        if root is None:
            continue
        # a registry brain whose root contains cwd IS here (spec/75) — marker or not
        is_here = (cwd.resolve().is_relative_to(root) if here is None
                   else root == here or here.is_relative_to(root))
        alias = entry.get("alias") or alias_for_repo(entry["repo"])
        brains.append(Brain(alias=alias, root=root, role=entry.get("role"), here=is_here))
    if here is not None and not any(b.here for b in brains):
        brains.insert(0, Brain(alias=None, root=here, here=True))
    if not brains:
        return BrainSet([Brain(alias=None, root=cwd.resolve(), here=True)])
    ordered = sorted(brains, key=lambda b: (0 if b.here else 1 if b.role == "user" else 2))
    return BrainSet(ordered)


def qualify_paths(alias: str, obj, keys=("path", "source", "target", "center", "target")):
    """Prefix every path-bearing field in a nested payload with alias: (spec/75)."""
    if isinstance(obj, list):
        return [qualify_paths(alias, item, keys) for item in obj]
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if key in keys and isinstance(value, str) and value:
                out[key] = qualify(alias, value)
            elif key in ("in", "out", "nodes", "edges", "docs", "tree", "neighbors", "top_ghosts",
                         "disambiguation"):
                out[key] = qualify_paths(alias, value, keys)
            else:
                out[key] = value
        return out
    return obj


def relative_root(root: Path, cwd: str | Path | None = None) -> str:
    """A short, human root for brain_overview's `brains` — relative to cwd when it
    sits below it, else the directory name."""
    cwd = Path.cwd() if cwd is None else Path(cwd)
    try:
        return root.relative_to(cwd.resolve()).as_posix() or "."
    except ValueError:
        return root.name


def parse_scope(brain_set: BrainSet, scope) -> tuple[list[Brain], list[str]]:
    """`all` | `here` | `me` | a comma-separated alias list → (brains, dropped names).
    Nothing surviving falls back to all — forgiving, never an error (spec/70)."""
    text = str(scope or "all").strip()
    chosen: list[Brain] = []
    dropped: list[str] = []
    for name in [n.strip() for n in text.split(",") if n.strip()]:
        if name == "all":
            chosen = list(brain_set.brains)
            continue
        brain = None
        if name == "here":
            brain = brain_set.here
        elif name == "me":
            brain = brain_set.user
        else:
            brain = brain_set.by_alias(name)
        if brain is None:
            dropped.append(name)
        elif brain not in chosen:
            chosen.append(brain)
    if not chosen:
        chosen = list(brain_set.brains)
    ordered = [b for b in brain_set.brains if b in chosen]
    return ordered, dropped


# -- migrating per-project host entries (spec/75 --from-hosts) ------------------------


@dataclass(frozen=True)
class HostRoot:
    """One `mcp --root DIR` found in agent host configs — DIR plus the hosts naming it."""
    root: Path
    hosts: list[str]


def _host_files(home: Path) -> list[tuple[str, Path]]:
    return [
        ("claude-code", home / ".claude.json"),
        ("opencode", home / ".config" / "opencode" / "opencode.json"),
        ("codex", home / ".codex" / "config.toml"),
        ("cursor", home / ".cursor" / "mcp.json"),
    ]


def _server_argv(server) -> list[str]:
    """The command line of one MCP server entry: `command` string + `args`, or
    a `command` array (OpenCode). Remote servers have neither and yield []."""
    if not isinstance(server, dict):
        return []
    command = server.get("command")
    if isinstance(command, list):
        return [str(part) for part in command]
    argv = [str(command)] if isinstance(command, str) else []
    args = server.get("args")
    if isinstance(args, list):
        argv += [str(part) for part in args]
    return argv


def _mcp_root_of(argv: list[str]) -> str | None:
    """`… mcp … --root DIR` (or `--root=DIR`) → DIR; anything else → None."""
    if "mcp" not in argv:
        return None
    tail = argv[argv.index("mcp") + 1:]
    for i, part in enumerate(tail):
        if part == "--root" and i + 1 < len(tail):
            return tail[i + 1]
        if part.startswith("--root="):
            return part[len("--root="):]
    return None


def _servers_in(host: str, path: Path) -> list:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    try:
        if host == "codex":
            return list(tomllib.loads(text).get("mcp_servers", {}).values())
        data = json.loads(text)
    except (ValueError, TypeError, tomllib.TOMLDecodeError):
        return []
    if not isinstance(data, dict):
        return []
    if host == "opencode":
        return list((data.get("mcp") or {}).values())
    servers = list((data.get("mcpServers") or {}).values())
    for project in (data.get("projects") or {}).values():  # Claude Code per-project scope
        if isinstance(project, dict):
            servers += list((project.get("mcpServers") or {}).values())
    return servers


def scan_hosts(env: Mapping[str, str] | None = None) -> list[HostRoot]:
    """Every distinct `brainpick mcp --root DIR` across the known host configs
    (spec/75), in discovery order. Pure read — never edits a host config."""
    env = os.environ if env is None else env
    home = Path(env.get("HOME", "~")).expanduser()
    found: dict[Path, list[str]] = {}
    for host, path in _host_files(home):
        for server in _servers_in(host, path):
            raw = _mcp_root_of(_server_argv(server))
            if raw is None:
                continue
            root = Path(raw).expanduser()
            hosts = found.setdefault(root, [])
            if host not in hosts:
                hosts.append(host)
    return [HostRoot(root, hosts) for root, hosts in found.items()]


__all__ = [
    "HostRoot", "scan_hosts",
    "Brain", "BrainSet", "alias_for", "discover_here", "load_registry", "parse_scope",
    "qualify", "qualify_paths", "register_brain", "registry_path", "resolve_brain_set",
    "save_registry", "split_qualified", "unregister_brain",
]
