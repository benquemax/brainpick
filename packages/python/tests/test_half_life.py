"""Half-life (spec/50 *Half-life*, spec/80 `[half_life]`): memories fade, and
that is a feature — a document's retrieval score is multiplied by
max(2^(-age/half_life), 1/16) so a stale page still surfaces but ranks below a
fresh one that says the same thing. Nothing is deleted; it only gets harder to
recall. Resolution: bundle default → longest matching folder → the doc's own
frontmatter `half_life`."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from brainpick.compile.pipeline import run_compile
from brainpick.compile.t1 import build_docs_records
from brainpick.config import HalfLifeConfig, load_config
from brainpick.core.bundle import scan
from brainpick.mcp_server import search_payload
from brainpick.query.half_life import age_days, effective_half_life, fade, fade_factor
from brainpick.query.keyword import search
from brainpick.query.router import run_search
from brainpick.serve.state import ServeState

NOW = datetime(2026, 8, 1, tzinfo=timezone.utc)


@pytest.fixture
def make_bundle(tmp_path):
    def build(files: dict[str, str]) -> Path:
        for name, text in files.items():
            (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
            (tmp_path / name).write_text(text, encoding="utf-8")
        return tmp_path
    return build


# -- config -----------------------------------------------------------------------


def test_half_life_config_defaults_to_nothing_fading(tmp_path):
    cfg = load_config(tmp_path, env={})
    assert cfg.half_life.default == 0
    assert cfg.half_life.folders == {}


def test_half_life_config_reads_default_and_folders(tmp_path):
    (tmp_path / "brainpick.toml").write_text(
        '[half_life]\ndefault = 90\n[half_life.folders]\njournals = 30\n"journals/archive" = 7\n'
        'skills = 0\nbroken = "soon"\n', encoding="utf-8")
    cfg = load_config(tmp_path, env={})
    assert cfg.half_life.default == 90
    assert cfg.half_life.folders == {"journals": 30.0, "journals/archive": 7.0, "skills": 0.0}


def test_half_life_env_overrides(tmp_path):
    cfg = load_config(tmp_path, env={"BRAINPICK_HALF_LIFE_DEFAULT": "45",
                                     "BRAINPICK_HALF_LIFE_FOLDERS": "journals=30, raw = 1.5"})
    assert cfg.half_life.default == 45
    assert cfg.half_life.folders == {"journals": 30.0, "raw": 1.5}


# -- resolution --------------------------------------------------------------------


@pytest.mark.parametrize("path,frontmatter,expected", [
    ("knowledge/kahvi.md", None, 90.0),               # bundle default
    ("journals/2026-07-01.md", None, 30.0),           # folder
    ("journals/archive/2026/07/x.md", None, 7.0),     # the most nested folder wins
    ("journalsx/y.md", None, 90.0),                   # a prefix is a folder, not a string prefix
    ("skills/veden-keitto.md", None, 0.0),            # folder says never
    ("journals/pinned.md", 0, 0.0),                   # frontmatter beats the folder
    ("knowledge/fresh.md", 3, 3.0),
])
def test_effective_half_life_most_specific_wins(path, frontmatter, expected):
    cfg = HalfLifeConfig(default=90, folders={"journals": 30, "journals/archive": 7, "skills": 0})
    assert effective_half_life(path, frontmatter, cfg) == expected


@pytest.mark.parametrize("timestamp,expected", [
    ("2026-07-02T00:00:00Z", 30.0),
    ("2026-07-02", 30.0),
    ("2026-07-02T12:00:00+02:00", 29.5 + 2 / 24),
    ("2026-07-02T00:00:00", 30.0),                    # naive = UTC
    ("2026-09-01T00:00:00Z", 0.0),                    # the future counts as now
    (None, None),
    ("last tuesday", None),
])
def test_age_days(timestamp, expected):
    result = age_days(timestamp, NOW)
    if expected is None:
        assert result is None
    else:
        assert result == pytest.approx(expected)


@pytest.mark.parametrize("age,half_life,expected", [
    (0.0, 30.0, 1.0),
    (30.0, 30.0, 0.5),
    (60.0, 30.0, 0.25),
    (3000.0, 30.0, 1 / 16),                           # the floor: four half-lives
    (30.0, 0.0, 1.0),                                 # never fades
    (None, 30.0, 1.0),                                # no timestamp, no fading
])
def test_fade_factor(age, half_life, expected):
    assert fade_factor(age, half_life) == pytest.approx(expected)


# -- ranking -----------------------------------------------------------------------


def _records(make_bundle):
    root = make_bundle({
        "index.md": "# I\n\n- [Old](old.md)\n- [New](new.md)\n- [Pinned](pinned.md)\n",
        "old.md": "---\ntitle: Old\ntimestamp: 2026-01-01T00:00:00Z\n---\n# Old\n\nkettle kettle kettle\n",
        "new.md": "---\ntitle: New\ntimestamp: 2026-07-31T00:00:00Z\n---\n# New\n\nkettle\n",
        "pinned.md": "---\ntitle: Pinned\ntimestamp: 2026-01-01T00:00:00Z\nhalf_life: 0\n---\n"
                     "# Pinned\n\nkettle kettle\n",
    })
    return root, build_docs_records(scan(root))


def test_records_carry_the_frontmatter_half_life(make_bundle):
    _, records = _records(make_bundle)
    by_path = {r["path"]: r for r in records}
    assert by_path["pinned.md"]["half_life"] == 0.0
    assert by_path["old.md"]["half_life"] is None


def test_fade_reranks_by_faded_score_and_path(make_bundle):
    _, records = _records(make_bundle)
    hits = search(records, "kettle", limit=8)
    assert [h["path"] for h in hits] == ["old.md", "pinned.md", "new.md"]
    faded = fade(hits, records, HalfLifeConfig(default=30), NOW)
    assert [h["path"] for h in faded] == ["pinned.md", "new.md", "old.md"]
    old = next(h for h in hits if h["path"] == "old.md")["score"]
    assert next(h for h in faded if h["path"] == "old.md")["score"] == pytest.approx(old / 16, abs=1e-6)


def test_fade_with_nothing_fading_is_byte_identical(make_bundle):
    _, records = _records(make_bundle)
    hits = search(records, "kettle", limit=8)
    assert fade(hits, records, HalfLifeConfig(), NOW) == hits
    assert fade(hits, records, None, NOW) == hits


def test_run_search_applies_the_half_life_in_keyword_mode(make_bundle):
    _, records = _records(make_bundle)
    body = run_search(records, {}, "kettle", mode="keyword", limit=8,
                      half_life=HalfLifeConfig(default=30), now=NOW)
    assert [h["path"] for h in body["hits"]] == ["pinned.md", "new.md", "old.md"]


def test_run_search_fades_the_semantic_ranking_too(make_bundle):
    _, records = _records(make_bundle)

    def semantic(query, limit):
        return [{"path": "old.md", "title": "Old", "description": None, "score": 0.9,
                 "snippet": None, "source": "semantic"},
                {"path": "new.md", "title": "New", "description": None, "score": 0.8,
                 "snippet": None, "source": "semantic"}]

    body = run_search(records, {"t2": "fresh"}, "kettle", mode="semantic", limit=8,
                      semantic_fn=semantic, half_life=HalfLifeConfig(default=30), now=NOW)
    assert [h["path"] for h in body["hits"]] == ["new.md", "old.md"]


def test_run_search_without_half_life_is_unchanged(make_bundle):
    _, records = _records(make_bundle)
    body = run_search(records, {}, "kettle", mode="keyword", limit=8)
    assert body == run_search(records, {}, "kettle", mode="keyword", limit=8, now=NOW)


# -- end to end ----------------------------------------------------------------------


def test_mcp_search_honours_the_bundle_half_life(kotiaivot):
    (kotiaivot / "brainpick.toml").write_text(
        'spec = "0.1"\n[bundle]\nexclude = ["raw/*"]\n[brain]\nformat = 2\n'
        '[half_life]\ndefault = 0\n[half_life.folders]\nskills = 1\n', encoding="utf-8")
    run_compile(kotiaivot)
    state = ServeState(kotiaivot, load_config(kotiaivot, env={}))
    state.reload_artifacts()
    # skills fade fast, knowledge never: the boosted skill sinks below the prose page
    hits = search_payload(state, "kahvi", mode="keyword", now=NOW)["hits"]
    assert hits[0]["path"] == "knowledge/kahvi.md"
    assert "faded" in hits[-1]["why"] or any("faded" in h["why"] for h in hits)


def test_why_names_the_fade(kotiaivot):
    (kotiaivot / "brainpick.toml").write_text(
        'spec = "0.1"\n[bundle]\nexclude = ["raw/*"]\n[brain]\nformat = 2\n[half_life]\ndefault = 1\n',
        encoding="utf-8")
    run_compile(kotiaivot)
    state = ServeState(kotiaivot, load_config(kotiaivot, env={}))
    state.reload_artifacts()
    hit = search_payload(state, "kahvi", mode="keyword", now=NOW)["hits"][0]
    assert hit["why"].endswith("; faded (30 days old, half-life 1 day)")


def test_docs_jsonl_golden_carries_half_life():
    golden = Path(__file__).resolve().parents[3] / "spec/fixtures/expected/kotiaurinko/.brainpick/t1/docs.jsonl"
    first = json.loads(golden.read_text(encoding="utf-8").splitlines()[0])
    assert "half_life" in first and first["half_life"] is None
