"""brainpick.toml layered under brainpick.local.toml (spec/80): defaults when
absent, the machine-local layer deep-merged over the shared one, env overrides
on top, unknown keys warn."""
from __future__ import annotations

import os
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10
    import tomli as tomllib

CONFIG_FILE = "brainpick.toml"              # shared, versioned bundle policy
LOCAL_CONFIG_FILE = "brainpick.local.toml"  # machine-local endpoints — gitignored

_TRUTHY = {"1", "true", "yes", "on"}
_FALSY = {"0", "false", "no", "off"}


@dataclass
class BundleConfig:
    root: str = "."
    include: list[str] = field(default_factory=lambda: ["**/*.md"])
    exclude: list[str] = field(default_factory=list)


@dataclass
class IndexConfig:
    mode: str = "section"
    file: str = "index.md"


@dataclass
class ServeConfig:
    host: str = "127.0.0.1"
    port: int = 4747
    transports: list[str] = field(default_factory=lambda: ["streamable-http"])
    watch: bool = True
    writes: str = "guarded"
    token: str = ""
    max_asset_bytes: int = 8388608  # 8 MiB — the POST /api/assets upload cap (spec/50)


@dataclass
class ValidateConfig:
    henxels: str = "auto"


@dataclass
class UiConfig:
    """[ui] — presentation policy the engine ships to the browser via /api/status
    (spec/50, spec/80), so the client stops guessing from the GPU tier."""

    max_nodes_mobile: int = 8000   # node cap the web UI applies on mobile/weak GPUs
    default_mode: str = "cosmos"   # cosmos | brain — the view the UI opens in


@dataclass
class ModulesConfig:
    vectors: str = "auto"  # auto | on | off — T2 (spec/30)
    graph: str = "off"     # auto | on | off — T3 (M3)
    ui: bool = True


@dataclass
class EmbeddingConfig:
    kind: str = ""      # ollama | openai-compatible | openai | fastembed | mock (test hook)
    endpoint: str = ""
    model: str = ""
    dim: int = 0        # 0 = unknown; discovered from the first embedding response


@dataclass
class ExtractionConfig:
    """[models.extraction] — the chat model that powers T3 and doubles as the
    merge resolver for stale brain_writes (spec/70)."""

    kind: str = ""         # ollama | openai-compatible | mock (test hook)
    endpoint: str = ""
    model: str = ""
    api_key_env: str = ""  # names an env var holding the key — never the key itself


@dataclass
class ModelsConfig:
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    extraction: ExtractionConfig = field(default_factory=ExtractionConfig)


@dataclass
class Config:
    spec: str = "0.1"
    bundle: BundleConfig = field(default_factory=BundleConfig)
    index: IndexConfig = field(default_factory=IndexConfig)
    modules: ModulesConfig = field(default_factory=ModulesConfig)
    models: ModelsConfig = field(default_factory=ModelsConfig)
    serve: ServeConfig = field(default_factory=ServeConfig)
    ui: UiConfig = field(default_factory=UiConfig)
    validate: ValidateConfig = field(default_factory=ValidateConfig)


_SECTIONS = ("bundle", "index", "modules", "serve", "ui", "validate")
_MODEL_TABLES = ("embedding", "extraction")
# [models.*] tables are nested and handled separately below.
_KNOWN_TOP = {"spec", "models", *_SECTIONS}


def _coerce(current, value):
    """Nudge a TOML value toward the default's type; forgiving, never raising."""
    if isinstance(current, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in _TRUTHY
    if isinstance(current, int):
        try:
            return int(value)
        except (TypeError, ValueError):
            return current
    if isinstance(current, list):
        if isinstance(value, list):
            return [str(v) for v in value]
        return [str(value)]
    return str(value)


def _from_env(current, raw: str):
    if isinstance(current, bool):
        lowered = raw.strip().lower()
        if lowered in _TRUTHY:
            return True
        if lowered in _FALSY:
            return False
        return current
    if isinstance(current, int):
        try:
            return int(raw)
        except ValueError:
            return current
    if isinstance(current, list):
        return [part.strip() for part in raw.split(",") if part.strip()]
    return raw


def config_layers(root: str | Path) -> list[Path]:
    """The layer files present at root, weakest first (spec/80 precedence)."""
    root = Path(root)
    return [root / name for name in (CONFIG_FILE, LOCAL_CONFIG_FILE) if (root / name).is_file()]


def _deep_merge(base: dict, overlay: dict) -> dict:
    """Tables merge recursively; scalars and lists replace (spec/80 layering)."""
    merged = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _warn_unknown(filename: str, data: dict, defaults: Config) -> None:
    """Per-layer unknown-key warnings — a newer brainpick's config never bricks this one."""
    for key in data:
        if key not in _KNOWN_TOP:
            warnings.warn(f"{filename}: unknown key '{key}' — ignored", stacklevel=3)
    for section_name in _SECTIONS:
        table = data.get(section_name)
        if not isinstance(table, dict):
            continue
        section = getattr(defaults, section_name)
        for key in table:
            if not hasattr(section, key):
                warnings.warn(f"{filename}: unknown key [{section_name}] {key} — ignored",
                              stacklevel=3)
    models = data.get("models")
    if not isinstance(models, dict):
        return
    for table_name, table in models.items():
        if table_name not in _MODEL_TABLES:
            warnings.warn(f"{filename}: unknown table [models.{table_name}] — ignored", stacklevel=3)
            continue
        if not isinstance(table, dict):
            continue
        model = getattr(defaults.models, table_name)
        for key in table:
            if not hasattr(model, key):
                warnings.warn(f"{filename}: unknown key [models.{table_name}] {key} — ignored",
                              stacklevel=3)


def _read_layers(root: Path, defaults: Config) -> dict:
    data: dict = {}
    for path in (root / CONFIG_FILE, root / LOCAL_CONFIG_FILE):
        if not path.is_file():
            continue
        try:
            layer = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as error:
            warnings.warn(f"{path.name} is not valid TOML ({error}) — layer ignored", stacklevel=3)
            continue
        _warn_unknown(path.name, layer, defaults)
        data = _deep_merge(data, layer)
    return data


def load_config(root: str | Path, env: Mapping[str, str] | None = None) -> Config:
    """<root>/brainpick.toml deep-merged under brainpick.local.toml; absent files
    mean all defaults (zero-config bundles); env (`BRAINPICK_*`) beats both layers."""
    root = Path(root)
    env = os.environ if env is None else env
    config = Config()

    data = _read_layers(root, config)
    if "spec" in data:
        config.spec = str(data["spec"])

    for section_name in _SECTIONS:
        section = getattr(config, section_name)
        table = data.get(section_name)
        if not isinstance(table, dict):
            continue
        for key, value in table.items():
            if hasattr(section, key):
                setattr(section, key, _coerce(getattr(section, key), value))

    models = data.get("models")
    if isinstance(models, dict):
        for table_name in _MODEL_TABLES:
            table = models.get(table_name)
            if not isinstance(table, dict):
                continue
            model = getattr(config.models, table_name)
            for key, value in table.items():
                if hasattr(model, key):
                    setattr(model, key, _coerce(getattr(model, key), value))

    for section_name in _SECTIONS:
        section = getattr(config, section_name)
        for key in vars(section):
            raw = env.get(f"BRAINPICK_{section_name.upper()}_{key.upper()}")
            if raw is not None:
                setattr(section, key, _from_env(getattr(section, key), raw))

    for table_name in _MODEL_TABLES:
        model = getattr(config.models, table_name)
        for key in vars(model):
            raw = env.get(f"BRAINPICK_MODELS_{table_name.upper()}_{key.upper()}")
            if raw is not None:
                setattr(model, key, _from_env(getattr(model, key), raw))

    return config
