"""brainpick.toml (spec/80): defaults when absent, env overrides, unknown keys warn."""
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


@dataclass
class ValidateConfig:
    henxels: str = "auto"


@dataclass
class Config:
    spec: str = "0.1"
    bundle: BundleConfig = field(default_factory=BundleConfig)
    index: IndexConfig = field(default_factory=IndexConfig)
    serve: ServeConfig = field(default_factory=ServeConfig)
    validate: ValidateConfig = field(default_factory=ValidateConfig)


_SECTIONS = ("bundle", "index", "serve", "validate")
# [modules] and [models.*] are specified but land with T2/T3 — known, silently ignored.
_KNOWN_TOP = {"spec", "modules", "models", *_SECTIONS}


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


def load_config(root: str | Path, env: Mapping[str, str] | None = None) -> Config:
    """Read <root>/brainpick.toml; absent file means all defaults (zero-config bundles)."""
    root = Path(root)
    env = os.environ if env is None else env
    config = Config()

    path = root / "brainpick.toml"
    data: dict = {}
    if path.is_file():
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as error:
            warnings.warn(f"brainpick.toml is not valid TOML ({error}) — using defaults", stacklevel=2)
            data = {}

    if "spec" in data:
        config.spec = str(data["spec"])
    for key in data:
        if key not in _KNOWN_TOP:
            warnings.warn(f"brainpick.toml: unknown key '{key}' — ignored", stacklevel=2)

    for section_name in _SECTIONS:
        section = getattr(config, section_name)
        table = data.get(section_name)
        if not isinstance(table, dict):
            continue
        for key, value in table.items():
            if not hasattr(section, key):
                warnings.warn(
                    f"brainpick.toml: unknown key [{section_name}] {key} — ignored", stacklevel=2,
                )
                continue
            setattr(section, key, _coerce(getattr(section, key), value))

    for section_name in _SECTIONS:
        section = getattr(config, section_name)
        for key in vars(section):
            raw = env.get(f"BRAINPICK_{section_name.upper()}_{key.upper()}")
            if raw is not None:
                setattr(section, key, _from_env(getattr(section, key), raw))

    return config
