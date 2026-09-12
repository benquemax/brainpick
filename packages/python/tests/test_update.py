"""The proactive new-version notice (spec/80 [update] check): a cached, silent,
opt-out registry lookup whose result surfaces where agents already look."""
import json
import time
from pathlib import Path

from brainpick.compile.t1 import render_report_block
from brainpick.update import (
    CACHE_TTL_S,
    check_for_update,
    is_newer,
    notice_for,
    registry_url,
)

TIERS = {"t1": "fresh", "t2": "off", "t3": "off"}


def test_is_newer_compares_the_semver_core_only():
    assert is_newer("0.5.0", "0.6.0")
    assert is_newer("0.5.0", "0.5.1")
    assert is_newer("0.9.9", "1.0.0")
    assert not is_newer("0.6.0", "0.6.0")
    assert not is_newer("0.6.0", "0.5.9")
    assert not is_newer("0.5.0", "0.6.0rc1")   # a pre-release never counts as newer
    assert not is_newer("0.5.0", "garbage")
    assert not is_newer("0.5.0", "")


def test_notice_names_the_exact_upgrade_command():
    assert notice_for("python", "0.5.0", "0.6.0") == {
        "current": "0.5.0", "latest": "0.6.0", "hint": "pip install -U brainpick",
    }
    assert notice_for("node", "0.5.0", "0.6.0")["hint"] == "npm install -g brainpick"
    assert notice_for("python", "0.6.0", "0.6.0") is None


def test_registry_url_per_engine():
    assert registry_url("python") == "https://pypi.org/pypi/brainpick/json"
    assert registry_url("node") == "https://registry.npmjs.org/brainpick/latest"


def test_check_fetches_once_then_serves_the_cache(tmp_path: Path):
    calls: list[str] = []

    def fetch(url: str) -> str | None:
        calls.append(url)
        return "0.6.0"

    first = check_for_update("python", "0.5.0", env={}, cache_dir=tmp_path, fetch=fetch)
    assert first == {"current": "0.5.0", "latest": "0.6.0", "hint": "pip install -U brainpick"}
    cached = json.loads((tmp_path / "latest.json").read_text(encoding="utf-8"))
    assert cached["impl"] == "python" and cached["latest"] == "0.6.0"
    assert "checked_at" in cached

    second = check_for_update("python", "0.5.0", env={}, cache_dir=tmp_path, fetch=fetch)
    assert second == first
    assert calls == ["https://pypi.org/pypi/brainpick/json"]  # once per 24 h


def test_check_refetches_after_the_ttl(tmp_path: Path):
    (tmp_path / "latest.json").write_text(json.dumps({
        "impl": "python", "latest": "0.5.0", "checked_at": time.time() - CACHE_TTL_S - 1,
    }), encoding="utf-8")
    result = check_for_update("python", "0.5.0", env={}, cache_dir=tmp_path, fetch=lambda _u: "0.7.0")
    assert result is not None and result["latest"] == "0.7.0"


def test_a_miss_is_silent_and_cached_as_a_miss(tmp_path: Path):
    calls: list[str] = []

    def fetch(url: str) -> str | None:
        calls.append(url)
        return None

    assert check_for_update("python", "0.5.0", env={}, cache_dir=tmp_path, fetch=fetch) is None
    assert check_for_update("python", "0.5.0", env={}, cache_dir=tmp_path, fetch=fetch) is None
    assert calls == [registry_url("python")]  # a miss is not retried until the TTL passes


def test_opt_out_never_touches_the_network_or_the_cache(tmp_path: Path):
    def fetch(_url: str) -> str | None:
        raise AssertionError("must not be called")

    for env in ({"BRAINPICK_UPDATE_CHECK": "false"}, {"BRAINPICK_UPDATE_CHECK": "0"}):
        assert check_for_update("python", "0.5.0", env=env, cache_dir=tmp_path, fetch=fetch) is None
    assert check_for_update("python", "0.5.0", env={}, cache_dir=tmp_path, fetch=fetch,
                            enabled=False) is None
    assert not (tmp_path / "latest.json").exists()


def test_the_check_is_off_in_the_test_suite():
    import os

    assert os.environ.get("BRAINPICK_UPDATE_CHECK") == "false"  # conftest sets it — no test hits pypi


def test_report_carries_the_engine_line_only_with_a_notice():
    graph = {"nodes": [], "stats": {"docs": 0, "edges": 0, "tags": 0, "orphans": 0, "ghosts": 0},
             "ghosts": []}
    plain = render_report_block(graph, TIERS, "docs")
    assert "Engine:" not in plain
    notice = {"current": "0.5.0", "latest": "0.6.0", "hint": "pip install -U brainpick"}
    noticed = render_report_block(graph, TIERS, "docs", update=notice)
    body = noticed.splitlines()
    assert body[-3] == "- Bundle root: docs"
    assert body[-2] == "- Engine: brainpick 0.5.0 — 0.6.0 available: pip install -U brainpick"
    assert body[-1].startswith("<!-- brainpick:end")


def test_update_check_is_config_and_env(kotiaurinko):
    from brainpick.config import load_config

    # env={} — the suite itself sets BRAINPICK_UPDATE_CHECK=false (conftest), which is the point
    assert load_config(kotiaurinko, env={}).update.check is True
    (kotiaurinko / "brainpick.local.toml").write_text("[update]\ncheck = false\n", encoding="utf-8")
    assert load_config(kotiaurinko, env={}).update.check is False
    (kotiaurinko / "brainpick.local.toml").unlink()
    assert load_config(kotiaurinko, env={"BRAINPICK_UPDATE_CHECK": "false"}).update.check is False
