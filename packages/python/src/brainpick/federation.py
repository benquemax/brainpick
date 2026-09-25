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
CORTEX = "cortex"       # the agent's own brain — at most one per set (spec/75)
IMPLANT = "implant"     # an attached repository bundle — any number
_LEGACY_CORTEX = "user"  # the former name of "cortex"; still read, never written
READ_WRITE = "read-write"  # access (spec/105): this mount may push — the default, never written
READ_ONLY = "read-only"    # this mount is a mirror: writes redirect, fixes go upstream as proposals


def normalize_access(value: str | None) -> str:
    """The registry `access` key: absent or unknown reads as read-write (spec/105)."""
    return READ_ONLY if value == READ_ONLY else READ_WRITE


def is_cortex(role: str | None) -> bool:
    """True for the cortex role, including its deprecated spelling `user` (spec/75)."""
    return role in (CORTEX, _LEGACY_CORTEX)


_SLUG = re.compile(r"[^a-z0-9]+")
_QUALIFIED = re.compile(r"^([a-z0-9][a-z0-9-]*):(.+)$")
_KEY_ORDER = ("id", "repo", "bundle_path", "port", "enabled", "host", "alias", "role", "access")
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
    base = _entry_base(entry, env)
    root = base / entry["bundle_path"] if entry.get("bundle_path") else base
    return root.resolve() if root.is_dir() else None


def _entry_base(entry: dict, env: dict | None = None) -> Path:
    """The repo (or daemon clone) a registry entry points at — where its
    brainpick.toml lives, one level above a `bundle_path` bundle."""
    repo = entry["repo"]
    return Path(repo).expanduser() if is_local_repo(repo) else data_dir(env) / "brains" / entry["id"]


def _split_root(root: Path) -> tuple[str, str]:
    """(repo, bundle_path) for a local bundle — the git repo above it when there is
    one, so the registry entry matches what the daemon would write."""
    from brainpick.detect import find_repo_root

    repo = find_repo_root(root)
    if repo is None or repo == root:
        return str(root), ""
    return str(repo), root.relative_to(repo).as_posix()


def _bundle_id(config_root: Path) -> str:
    """`[bundle] id` from the config that governs the bundle — at the repo, not
    the bundle, when they differ — else a fresh id."""
    from brainpick.config import generate_bundle_id, load_config

    return load_config(config_root).bundle.id or generate_bundle_id()


def register_brain(root: str | Path, path: str | Path | None = None, alias: str | None = None,
                   user: bool = False, role: str | None = None,
                   access: str | None = None) -> dict:
    """Add the bundle at `root` to the registry (or update its entry in place when the
    same root is already registered). Returns the entry written.

    `role` is "cortex" (at most one in a registry — the newest claim wins) or
    "implant" (any number). `user=True` is the deprecated spelling of
    role="cortex" (spec/75). `access` is "read-only" (this mount may not push —
    spec/105) or "read-write" (the default; clears the key)."""
    root = Path(root).resolve()
    entries = load_registry(path)
    repo, bundle_path = _split_root(root)
    existing = next((e for e in entries if entry_root(e) == root), None)
    used_ports = {e["port"] for e in entries if e is not existing}
    port = existing["port"] if existing else DEFAULT_PORT_BASE
    while port in used_ports:
        port += 1
    entry = dict(existing) if existing else {
        "id": _bundle_id(Path(repo)), "repo": repo, "bundle_path": bundle_path, "port": port,
        "enabled": True, "host": DEFAULT_HOST,
    }
    if alias:
        entry["alias"] = slugify_alias(alias)
    if user and role is None:
        role = CORTEX  # --user is the deprecated spelling of --cortex
    if role is not None:
        entry["role"] = role
        if role == CORTEX:
            for other in entries:
                if other is not existing and is_cortex(other.get("role")):
                    other.pop("role")  # one cortex — the newest claim wins
    if access is not None:
        if normalize_access(access) == READ_ONLY:
            entry["access"] = READ_ONLY
        else:
            entry.pop("access", None)  # the default is not written
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


def brain_link_for(brain, rel: str) -> str | None:
    """The spec/85 cross-brain link to `rel` in `brain` — slug-then-id — or None when
    the brain has no [bundle] id to be addressed by (spec/105)."""
    from brainpick.config import load_config

    try:
        bundle_id = load_config(brain.config_root or brain.root).bundle.id
    except Exception:  # noqa: BLE001 — no link is better than a wrong one
        return None
    if not bundle_id:
        return None
    return f"brain://{brain.alias}-{bundle_id}/{rel.lstrip('/')}"


# -- the brain set ---------------------------------------------------------------------


def is_bundle_root(path: Path) -> bool:
    return (path / "brainpick.toml").is_file() or (path / ".brainpick").is_dir()


def discover_here(cwd: str | Path) -> Path | None:
    """The nearest ancestor-or-self of cwd that is a bundle root (spec/75) — the
    BUNDLE a repo-root brainpick.toml governs, not the repo: a config with
    `[bundle] root = "_brain"` marks the repo as a config root, and taking it as
    the bundle compiled every .md in the repo as a second brain."""
    found = discover_here_with_config(cwd)
    return found[0] if found else None


def discover_here_with_config(cwd: str | Path) -> tuple[Path, Path] | None:
    """(bundle root, config root) for `here`, or None. The config root is where
    brainpick.toml lives; it equals the bundle root unless [bundle] root points
    below it."""
    from brainpick.config import resolve_bundle

    path = Path(cwd).resolve()
    for candidate in (path, *path.parents):
        if (candidate / "brainpick.toml").is_file():
            bundle, _ = resolve_bundle(candidate)
            return bundle, candidate
        if (candidate / ".brainpick").is_dir():
            return candidate, candidate
    return None


@dataclass
class Brain:
    alias: str | None
    root: Path
    role: str | None = None
    here: bool = False
    # Whether THIS mount may push (spec/105): read-write, or read-only — a mirror of
    # upstream whose writes redirect and whose fixes travel as proposals.
    access: str = READ_WRITE
    # Where brainpick.toml lives when the bundle is a subdirectory of its repo
    # ([bundle] root, spec/80). `root` is the bundle; the config is NOT there, so
    # loading it from `root` silently yields defaults (no [serve] git, no
    # [half_life], no [bundle] exclude). None means the bundle is its own root.
    config_root: Path | None = None
    state: object = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self.root = Path(self.root).resolve()
        self.access = normalize_access(self.access)
        if self.config_root is not None:
            self.config_root = Path(self.config_root).resolve()

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
    def cortex(self) -> Brain | None:
        """The agent's own brain — scope `me`, and where an unqualified write falls
        back when there is no `here`. Several claimants: the first in set order wins."""
        return next((b for b in self.brains if is_cortex(b.role)), None)

    @property
    def user(self) -> Brain | None:
        """Deprecated alias of `cortex` (spec/75)."""
        return self.cortex

    @property
    def implants(self) -> list[Brain]:
        return [b for b in self.brains if b.role == IMPLANT]

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

            state = ServeState(brain.root, load_config(brain.config_root or brain.root))
            state.load()
            brain.state = state
        return brain.state

    def readable_state_for(self, brain: Brain):
        """`state_for`, but a brain that cannot be read degrades instead of raising
        (spec/100 *An implant that cannot be read*): → (state, None) or
        (None, reason). One unreadable implant must never take the set down with
        it — the cortex it hides is the knowledge needed to fix it."""
        reason = self.unreadable_reason(brain)
        if reason is not None:
            return None, reason
        try:
            return self.state_for(brain), None
        except Exception as error:  # noqa: BLE001 — degrade per brain, never per set
            return None, describe_unreadable(error)

    def unreadable_reason(self, brain: Brain) -> str | None:
        """Why this brain cannot be read, in words an agent can act on — or None
        when it is fine. Checked before any compile, because compiling an absent
        or unreadable root is what used to invent a phantom brain."""
        import json

        if brain.state is not None:
            return None
        try:
            if not brain.root.exists():
                return "the bundle root does not exist"
            if not brain.root.is_dir():
                return "the bundle root is not a directory"
            if not os.access(brain.root, os.R_OK | os.X_OK):
                return "permission denied reading the bundle"
        except OSError as error:  # Path.exists() masks EACCES as False; stat may still raise
            return describe_unreadable(error)
        path = brain.root / ".brainpick" / "manifest.json"
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None  # never compiled here — state_for compiles it, legitimately
        except OSError as error:
            return describe_unreadable(error)
        try:
            json.loads(raw)
        except ValueError:
            return "manifest.json is not valid JSON"
        return None

    def manifest_of(self, brain: Brain) -> dict:
        """Manifest only — what brain_overview's `brains` needs without loading.
        Callers MUST consult `unreadable_reason` first: an empty dict here means
        "no manifest yet", never "unreadable" (spec/100 forbids reporting a brain
        that could not be read as an empty one)."""
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
            config_root = (cwd / path).resolve()
            root, _ = resolve_bundle(config_root, env)  # --root may be a repo root above the bundle (spec/80)
            brains.append(Brain(alias=alias, root=root, here=(root == discover_here(cwd)),
                                config_root=config_root))
        return BrainSet(brains)

    found = discover_here_with_config(cwd)
    here, here_config = found if found else (None, None)
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
        brains.append(Brain(alias=alias, root=root, role=entry.get("role"), here=is_here,
                            access=normalize_access(entry.get("access")),
                            config_root=_entry_base(entry, env)))
    if here is not None and not any(b.here for b in brains):
        brains.insert(0, Brain(alias=None, root=here, here=True, config_root=here_config))
    if not brains:
        return BrainSet([Brain(alias=None, root=cwd.resolve(), here=True)])
    ordered = sorted(brains, key=lambda b: (0 if b.here else 1 if is_cortex(b.role) else 2))
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
            elif key in ("depends_on", "tools") and isinstance(value, list) \
                    and all(isinstance(v, str) for v in value):
                out[key] = [qualify(alias, v) if v else v for v in value]  # skills' path lists
            elif key in ("in", "out", "nodes", "edges", "docs", "tree", "neighbors", "top_ghosts",
                         "disambiguation", "skills", "skill", "depends_on", "dependents", "tools"):
                out[key] = qualify_paths(alias, value, keys)
            else:
                out[key] = value
        return out
    return obj


def describe_unreadable(error: Exception) -> str:
    """An exception, as a phrase about the BUNDLE rather than about the engine
    (spec/100): the agent reading it has to fix a repository, not debug a
    traceback."""
    if isinstance(error, PermissionError):
        return "permission denied reading the bundle"
    if isinstance(error, FileNotFoundError):
        return "the bundle root does not exist"
    if isinstance(error, ValueError):  # JSONDecodeError and friends
        return "manifest.json is not valid JSON"
    if isinstance(error, OSError):
        return f"the bundle could not be read ({error.strerror or 'I/O error'})"
    return "the bundle could not be read"


def skew_of(entries: list[dict]) -> dict | None:
    """spec/100: the version/format disagreement across a SET, or None when it is
    uniform. `entries` are the `brains` listing rows. A null value is unknown, not
    behind — a wiki has no format, an uncompiled brain no version — and an
    unreadable brain is excluded entirely (it is a louder problem, reported
    separately)."""
    from brainpick.releases import _core

    result: dict = {}
    rows = [e for e in entries if not e.get("unreadable")]

    formats = [(e["alias"], e["format"]) for e in rows if isinstance(e.get("format"), int)]
    if formats:
        latest = max(f for _, f in formats)
        behind = sorted(((a, f) for a, f in formats if f < latest), key=lambda p: (p[1], p[0]))
        if behind:
            result["format"] = {"latest": latest,
                                "behind": [{"alias": a, "format": f} for a, f in behind]}

    # A version that does not parse is unknown, not behind — never guess an order.
    versions = [(e["alias"], e["version"], _core(e["version"])) for e in rows
                if isinstance(e.get("version"), str)]
    versions = [(a, v, c) for a, v, c in versions if c is not None]
    if versions:
        top = max(c for _, _, c in versions)
        latest_v = next(v for _, v, c in versions if c == top)
        behind_v = sorted(((a, v, c) for a, v, c in versions if c < top),
                          key=lambda row: (row[2], row[0]))
        if behind_v:
            result["version"] = {"latest": latest_v,
                                 "behind": [{"alias": a, "version": v} for a, v, _ in behind_v]}

    if not result:
        return None
    parts = []
    if "format" in result:
        names = ", ".join(b["alias"] for b in result["format"]["behind"])
        latest = result["format"]["latest"]
        one = len(result["format"]["behind"]) == 1
        at = (f"is at {result['format']['behind'][0]['format']}" if one else "are behind")
        parts.append(
            f"brain format skew: {names} {at}, this set is at {latest} — conventions and "
            f"journal paths differ between them; verify where a doc belongs before writing "
            f"to {names} (brainpick migrate --to {latest})")
    if "version" in result:
        names = ", ".join(b["alias"] for b in result["version"]["behind"])
        parts.append(
            f"engine skew: {names} last compiled by an older brainpick than "
            f"{result['version']['latest']} — recompile with the current engine "
            f"(brainpick compile)")
    result["hint"] = "; ".join(parts) + "."
    return result


def unreadable_hint(unreadable: list[dict]) -> str:
    """spec/100: the loud half. Names every brain that could not be read and the
    one command that fixes it."""
    n = len(unreadable)
    names = ", ".join(f"{u['alias']} ({u['reason']})" for u in unreadable)
    roots = " ".join(f"--root {u['root']}" for u in unreadable[:1])
    return (f"{n} brain{'s' if n != 1 else ''} could not be read: {names}. "
            f"Other brains still answer; fix with `brainpick compile {roots}`.")


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
            brain = brain_set.cortex
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
    "Brain", "BrainSet", "CORTEX", "IMPLANT", "alias_for", "discover_here", "is_cortex",
    "load_registry", "parse_scope",
    "qualify", "qualify_paths", "register_brain", "registry_path", "resolve_brain_set",
    "save_registry", "split_qualified", "unregister_brain",
]
