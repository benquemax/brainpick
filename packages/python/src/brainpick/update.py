"""The proactive new-version notice (spec/80 `[update] check`).

Agents never check for updates; the brain tells them. One registry lookup per
24 h, probe-timed (a miss is silent), cached under ~/.cache/brainpick, opt-out
by config or `BRAINPICK_UPDATE_CHECK=false`. The result is surfaced — never
enforced — where agents already look: the AGENTS.md report (spec/20), the
`brain_overview` payload (spec/70) and one line of compile output.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Callable, Mapping

CACHE_TTL_S = 24 * 3600
PROBE_TIMEOUT_S = 0.3  # spec/30's probe budget: never make a compile feel slow
ENV_SWITCH = "BRAINPICK_UPDATE_CHECK"
_FALSY = {"0", "false", "no", "off"}
_SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
REGISTRY = {
    "python": "https://pypi.org/pypi/brainpick/json",
    "node": "https://registry.npmjs.org/brainpick/latest",
}
UPGRADE_HINT = {
    "python": "pip install -U brainpick",
    "node": "npm install -g brainpick",
}


def registry_url(impl: str) -> str:
    return REGISTRY[impl]


def default_cache_dir() -> Path:
    return Path(os.path.expanduser("~")) / ".cache" / "brainpick"


def _core(version: str) -> tuple[int, int, int] | None:
    match = _SEMVER.match(version.strip())
    return (int(match[1]), int(match[2]), int(match[3])) if match else None


def is_newer(current: str, latest: str) -> bool:
    """Semantic comparison on the MAJOR.MINOR.PATCH core; a pre-release or an
    unparsable string never counts as newer (spec/80)."""
    a, b = _core(current), _core(latest or "")
    return a is not None and b is not None and b > a


def notice_for(impl: str, current: str, latest: str | None) -> dict | None:
    if latest is None or not is_newer(current, latest):
        return None
    return {"current": current, "latest": latest, "hint": UPGRADE_HINT[impl]}


def fetch_latest(url: str) -> str | None:
    """One HTTPS GET within the probe budget; any failure is a silent miss."""
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=PROBE_TIMEOUT_S) as response:  # noqa: S310
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if "info" in data and isinstance(data["info"], dict):  # PyPI shape
        version = data["info"].get("version")
    else:  # npm `/latest` shape
        version = data.get("version")
    return version if isinstance(version, str) else None


def check_for_update(
    impl: str,
    current: str,
    env: Mapping[str, str] | None = None,
    cache_dir: Path | None = None,
    fetch: Callable[[str], str | None] = fetch_latest,
    enabled: bool = True,
) -> dict | None:
    """The notice `{current, latest, hint}` when something newer is known, else
    None. Opt-out (config or env) never touches the network or the cache."""
    env = os.environ if env is None else env
    if not enabled or env.get(ENV_SWITCH, "").strip().lower() in _FALSY:
        return None
    cache_dir = default_cache_dir() if cache_dir is None else cache_dir
    cache = cache_dir / "latest.json"

    latest: str | None = None
    fresh = False
    try:
        cached = json.loads(cache.read_text(encoding="utf-8"))
        if (isinstance(cached, dict) and cached.get("impl") == impl
                and time.time() - float(cached.get("checked_at", 0)) < CACHE_TTL_S):
            latest, fresh = cached.get("latest"), True
    except Exception:
        pass
    if not fresh:
        latest = fetch(registry_url(impl))  # a miss is cached as a miss: no retry storm
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({"impl": impl, "checked_at": time.time(), "latest": latest}),
                             encoding="utf-8")
        except Exception:
            pass  # a read-only home never blocks a compile
    return notice_for(impl, current, latest if isinstance(latest, str) else None)
