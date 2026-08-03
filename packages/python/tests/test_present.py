"""CLI presentation of brain_overview (spec/45's similarity_gaps_open_count line)."""
from brainpick.query.present import present_overview


def test_overview_prints_similarity_gaps_open_count():
    payload = {
        "bundle": "kotiaurinko",
        "counts": {"docs": 1, "edges": 0, "tags": 0, "orphans": 0, "ghosts": 0},
        "tiers": {"t1": "fresh", "t2": "fresh", "t3": "fresh"},
        "tree": [],
        "similarity_gaps_open_count": 3,
    }
    text = present_overview(payload)
    assert "similarity gaps: 3 open" in text


def test_overview_similarity_gaps_line_omitted_when_absent():
    payload = {"bundle": "b", "counts": {}, "tiers": {}, "tree": []}
    assert "similarity gaps" not in present_overview(payload)
