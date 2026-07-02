from brainpick.compile.t1 import build_docs_records
from brainpick.core.bundle import scan
from brainpick.query.keyword import search


def test_keyword_search_set(kotiaurinko):
    records = build_docs_records(scan(kotiaurinko))
    hits = search(records, "aurinko", limit=8)
    assert {h["path"] for h in hits} == {
        "aurinko.md", "komeetta.md", "planeetat.md", "yksinainen.md",
    }
    # the doc titled Aurinko outranks passing mentions
    assert hits[0]["path"] == "aurinko.md"
    # reserved docs never surface (index.md links everything)
    assert all(not h["path"].endswith("index.md") for h in hits)


def test_search_result_shape(kotiaurinko):
    records = build_docs_records(scan(kotiaurinko))
    (hit,) = [h for h in search(records, "tides", limit=3) if h["path"] == "kuu.md"]
    assert set(hit) == {"description", "path", "score", "snippet", "source", "title"}
    assert hit["source"] == "keyword"
    assert "tides" in hit["snippet"]


def test_no_hits(kotiaurinko):
    records = build_docs_records(scan(kotiaurinko))
    assert search(records, "zzzzz kuulumaton", limit=5) == []
