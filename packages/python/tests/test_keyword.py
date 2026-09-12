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


# -- tags and stem terms (spec/50) ------------------------------------------------


def test_search_terms_adds_a_4_char_prefix_for_tokens_of_5_plus():
    from brainpick.query.keyword import search_terms

    assert search_terms("kahvia kahvi Agents cup") == [
        "kahvia", "kahv", "kahvi", "kahv", "agents", "agen", "cup",
    ]
    assert search_terms("a bb ccc dddd") == ["a", "bb", "ccc", "dddd"]  # < 5 chars: untouched


def test_tags_are_searchable(kotiaivot):
    records = build_docs_records(scan(kotiaivot, exclude=("raw/*",)))
    # `vesi` is veden-keitto's TAG only — not in title, description or body
    assert [h["path"] for h in search(records, "vesi", limit=8)] == ["skills/veden-keitto.md"]


def test_inflected_query_reaches_its_stem(kotiaivot):
    records = build_docs_records(scan(kotiaivot, exclude=("raw/*",)))
    paths = {h["path"] for h in search(records, "kahvia", limit=8)}
    assert paths == {"knowledge/kahvi.md", "knowledge/vieraat.md",
                     "skills/kahvin-keitto.md", "skills/veden-keitto.md",
                     "todo/archive/2026-07-01.md"}


def test_exact_token_still_outranks_a_stem_only_match(kotiaurinko):
    records = build_docs_records(scan(kotiaurinko))
    exact = search(records, "aurinko", limit=8)
    assert exact[0]["path"] == "aurinko.md"
    # a stem-only query returns the same set, but a stem never beats an exact title
    stem = search(records, "aurinkoa", limit=8)
    assert {h["path"] for h in stem} == {h["path"] for h in exact}
    assert stem[0]["score"] < exact[0]["score"]
