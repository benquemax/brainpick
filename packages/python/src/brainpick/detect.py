"""Environment detection for init/doctor (docs/embedding-detection.md, docs/onboarding.md).

Detect rather than interrogate: bundle shape and link style come from reading the
markdown, backends from parallel 300 ms probes. A probe that fails is a silent miss —
detection never raises and never stalls the choreography.
"""
from __future__ import annotations

import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import httpx

from brainpick.core.bundle import ALWAYS_EXCLUDED_DIRS
from brainpick.core.frontmatter import split_frontmatter
from brainpick.core.links import extract_links

PROBE_TIMEOUT = 0.3  # seconds; a miss must never make init feel slow
PREFERRED_EMBEDDING_MODELS = (
    "nomic-embed-text",
    "mxbai-embed-large",
    "snowflake-arctic-embed2",
    "bge-m3",
)
DEFAULT_OLLAMA = "http://127.0.0.1:11434"
DEFAULT_OPENAI_COMPATIBLE = (
    ("lm studio", "http://127.0.0.1:1234"),
    ("llama.cpp", "http://127.0.0.1:8080"),
)
MIN_TYPED_DOCS = 3  # density scan: this many `type:` frontmatters look like a bundle


@dataclass(frozen=True)
class Backend:
    kind: str  # "ollama" | "openai-compatible" | "openai"
    endpoint: str
    model: str | None  # None: the endpoint answered but offers no embedding model


@dataclass(frozen=True)
class BundleInfo:
    kind: str  # "okf" | "density" | "none"
    docs: int  # markdown files seen (excluded dirs skipped)
    typed: int  # of those, files with `type:` frontmatter


@dataclass(frozen=True)
class LinkStyle:
    style: str  # "markdown" | "wikilinks" | "mixed" | "none"
    markdown: int
    wikilinks: int


# -- bundle ------------------------------------------------------------------------


def _markdown_files(root: Path) -> list[Path]:
    files = []
    for path in sorted(root.rglob("*.md")):
        parts = path.relative_to(root).parts
        if any(part in ALWAYS_EXCLUDED_DIRS for part in parts[:-1]):
            continue
        if path.is_file():
            files.append(path)
    return files


def detect_bundle(root: str | Path) -> BundleInfo:
    """okf (index.md declares okf_version) > density (>= 3 typed docs) > none."""
    root = Path(root)
    files = _markdown_files(root)
    okf = False
    typed = 0
    for path in files:
        meta, _body = split_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        if path == root / "index.md" and meta.get("okf_version") is not None:
            okf = True
        if meta.get("type") is not None:
            typed += 1
    if okf:
        return BundleInfo("okf", len(files), typed)
    if typed >= MIN_TYPED_DOCS:
        return BundleInfo("density", len(files), typed)
    return BundleInfo("none", len(files), typed)


def detect_link_style(root: str | Path) -> LinkStyle:
    """Informational in 0.1: how this bundle links, counted from the bodies."""
    root = Path(root)
    markdown = wikilinks = 0
    for path in _markdown_files(root):
        _meta, body = split_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        for link in extract_links(body):
            if link.kind == "wikilink":
                wikilinks += 1
            else:
                markdown += 1
    if markdown == 0 and wikilinks == 0:
        style = "none"
    elif wikilinks == 0:
        style = "markdown"
    elif markdown == 0:
        style = "wikilinks"
    else:
        style = "mixed"
    return LinkStyle(style, markdown, wikilinks)


# -- backends ----------------------------------------------------------------------


def _get_json(url: str) -> dict | None:
    try:
        response = httpx.get(url, timeout=PROBE_TIMEOUT)
        response.raise_for_status()
        data = response.json()
    except Exception:
        return None  # a miss is silent — down, slow, or gibberish all mean "not here"
    return data if isinstance(data, dict) else None


def _pick_embedding_model(names: list[str]) -> str | None:
    embeddable = [name for name in names if "embed" in name.lower()]
    for preferred in PREFERRED_EMBEDDING_MODELS:
        for name in embeddable:
            if preferred in name:
                return name
    return embeddable[0] if embeddable else None


def _normalize_host(value: str) -> str:
    value = value.strip().rstrip("/")
    if "://" not in value:
        value = f"http://{value}"
    return value


def probe_ollama(env: Mapping[str, str] | None = None) -> Backend | None:
    env = os.environ if env is None else env
    base = _normalize_host(env.get("OLLAMA_HOST") or DEFAULT_OLLAMA)
    data = _get_json(f"{base}/api/tags")
    if data is None:
        return None
    names = [str(m.get("name", "")) for m in data.get("models", []) if isinstance(m, dict)]
    return Backend("ollama", base, _pick_embedding_model(names))


def probe_openai_compatible(base: str) -> Backend | None:
    base = _normalize_host(base)
    data = _get_json(f"{base}/v1/models")
    if data is None:
        return None
    ids = [str(m.get("id", "")) for m in data.get("data", []) if isinstance(m, dict)]
    return Backend("openai-compatible", f"{base}/v1", _pick_embedding_model(ids))


def probe_backends(
    env: Mapping[str, str] | None = None,
    openai_compatible: tuple[tuple[str, str], ...] = DEFAULT_OPENAI_COMPATIBLE,
) -> list[tuple[str, Backend | None]]:
    """All probes in parallel, ladder order preserved: ollama, then OpenAI-compatible."""
    env = os.environ if env is None else env
    with ThreadPoolExecutor(max_workers=1 + len(openai_compatible)) as pool:
        first = pool.submit(probe_ollama, env)
        rest = [(label, pool.submit(probe_openai_compatible, base)) for label, base in openai_compatible]
        results: list[tuple[str, Backend | None]] = [("ollama", first.result())]
        results.extend((label, future.result()) for label, future in rest)
    return results


def pick_backend(results: list[tuple[str, Backend | None]]) -> Backend | None:
    """The first backend that actually has an embedding model — the ladder's answer."""
    for _label, backend in results:
        if backend is not None and backend.model is not None:
            return backend
    return None


def openai_key_present(env: Mapping[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return bool(env.get("OPENAI_API_KEY"))


# -- surroundings ------------------------------------------------------------------


def find_repo_root(start: str | Path) -> Path | None:
    """The nearest ancestor (or self) holding a .git — where .gitignore would live."""
    path = Path(start).resolve()
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def detect_henxels(root: str | Path) -> Path | None:
    """henxels.yaml at the bundle root, or at the repo root above it."""
    root = Path(root).resolve()
    contract = root / "henxels.yaml"
    if contract.is_file():
        return contract
    repo = find_repo_root(root)
    if repo is not None and repo != root:
        contract = repo / "henxels.yaml"
        if contract.is_file():
            return contract
    return None


def henxels_on_path() -> bool:
    return shutil.which("henxels") is not None
