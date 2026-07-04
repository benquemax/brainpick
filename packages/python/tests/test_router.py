"""Search routing (spec/30 + spec/50): mode resolution, RRF fusion, honest degradation."""
from brainpick.query.router import RRF_K, is_relational, resolve_mode, rrf_fuse, run_search

FRESH = {"t1": "fresh", "t2": "fresh", "t3": "off"}
NO_T2 = {"t1": "fresh", "t2": "off", "t3": "off"}
STALE_T2 = {"t1": "fresh", "t2": "stale", "t3": "off"}


def record(path, title, text, description=None):
    return {
        "path": path, "title": title, "description": description, "text": text,
        "reserved": False, "sha256": "x", "tags": [], "timestamp": None, "type": "Concept",
    }


RECORDS = [
    record("aurinko.md", "Aurinko", "aurinko aurinko keskellä"),
    record("kuu.md", "Kuu", "kuu kiertää maata"),
    record("maa.md", "Maa", "maa on sininen"),
]


def hit(path, score=1.0, snippet=None, source="keyword"):
    return {"path": path, "title": path, "description": None,
            "score": score, "snippet": snippet, "source": source}


def semantic_stub(paths):
    def run(query, limit):
        return [hit(p, score=0.9, source="semantic") for p in paths][:limit]
    return run


def graph_stub(paths):
    def run(query, limit):
        return [hit(p, score=0.8, source="graph") for p in paths][:limit]
    return run


def broken_semantic(query, limit):
    raise RuntimeError("store is gone")


# -- mode resolution -----------------------------------------------------------------


def test_unknown_mode_resolves_to_auto():
    assert resolve_mode("banana") == "auto"
    assert resolve_mode(None) == "auto"
    assert resolve_mode("semantic") == "semantic"


# -- RRF fusion ----------------------------------------------------------------------


def test_rrf_fuse_scores_and_sources():
    fused = rrf_fuse({
        "keyword": [hit("a.md"), hit("b.md"), hit("c.md")],
        "semantic": [hit("c.md", source="semantic"), hit("a.md", source="semantic")],
    }, limit=8)
    assert [h["path"] for h in fused] == ["a.md", "c.md", "b.md"]
    a, c, b = fused
    assert a["score"] == round(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 6)
    assert c["score"] == round(1 / (RRF_K + 3) + 1 / (RRF_K + 1), 6)
    assert b["score"] == round(1 / (RRF_K + 2), 6)
    assert a["source"] == "keyword"    # its best rank came from keyword (1 vs 2)
    assert c["source"] == "semantic"   # rank 1 semantic beats rank 3 keyword
    assert b["source"] == "keyword"


def test_rrf_fuse_ties_break_on_path_and_dedupe_by_doc():
    fused = rrf_fuse({
        "keyword": [hit("b.md"), hit("a.md")],
        "semantic": [hit("a.md", source="semantic"), hit("b.md", source="semantic")],
    }, limit=8)
    assert [h["path"] for h in fused] == ["a.md", "b.md"]  # equal scores: path order
    assert len(fused) == 2


def test_rrf_fuse_respects_limit():
    fused = rrf_fuse({"keyword": [hit(f"{i}.md") for i in range(10)]}, limit=3)
    assert len(fused) == 3


# -- run_search ----------------------------------------------------------------------


def test_keyword_mode_never_degrades():
    body = run_search(RECORDS, NO_T2, "aurinko", mode="keyword")
    assert body["used_modes"] == ["keyword"]
    assert body["degraded_from"] is None
    assert body["hits"][0]["path"] == "aurinko.md"


def test_semantic_degrades_to_keyword_when_t2_not_fresh():
    for tiers in (NO_T2, STALE_T2):
        body = run_search(RECORDS, tiers, "aurinko", mode="semantic")
        assert body["used_modes"] == ["keyword"]
        assert body["degraded_from"] == "semantic"


def test_auto_degrades_with_marker_when_t2_not_fresh():
    body = run_search(RECORDS, NO_T2, "aurinko", mode="auto")
    assert body["used_modes"] == ["keyword"]
    assert body["degraded_from"] == "semantic"  # spec/30: auto degrades like semantic


def test_graph_mode_degrades_to_keyword_when_t3_absent():
    body = run_search(RECORDS, FRESH, "aurinko", mode="graph",
                      semantic_fn=semantic_stub(["kuu.md"]))
    assert body["used_modes"] == ["keyword"]
    assert body["degraded_from"] == "graph"
    assert body["hits"][0]["path"] == "aurinko.md"


def test_graph_mode_uses_the_entity_graph_when_present():
    body = run_search(RECORDS, FRESH, "aurinko", mode="graph",
                      semantic_fn=semantic_stub(["kuu.md"]),
                      graph_fn=graph_stub(["maa.md", "kuu.md"]))
    assert body["used_modes"] == ["graph"]
    assert body["degraded_from"] is None
    assert [h["path"] for h in body["hits"]] == ["maa.md", "kuu.md"]
    assert all(h["source"] == "graph" for h in body["hits"])


# -- is_relational heuristic (spec/40) -----------------------------------------------


def test_is_relational_matches_connection_words():
    assert is_relational("how does the moon relate to the tides")
    assert is_relational("what connects to Aurinko")
    assert is_relational("the link between maa and kuu")
    assert is_relational("related work")  # substring stems catch inflections
    assert not is_relational("aurinko")
    assert not is_relational("tides of the moon")


def test_auto_widens_with_graph_only_for_relational_queries():
    graph = graph_stub(["planeetat.md"])
    plain = run_search(RECORDS, FRESH, "aurinko", mode="auto",
                       semantic_fn=semantic_stub(["aurinko.md"]), graph_fn=graph)
    assert plain["used_modes"] == ["keyword", "semantic"]  # not relational → no graph

    relational = run_search(RECORDS, FRESH, "what connects to aurinko", mode="auto",
                            semantic_fn=semantic_stub(["aurinko.md"]), graph_fn=graph)
    assert relational["used_modes"] == ["keyword", "semantic", "graph"]
    assert "planeetat.md" in {h["path"] for h in relational["hits"]}  # graph-only recall joins


def test_auto_relational_graph_still_marks_semantic_degrade_when_t2_off():
    body = run_search(RECORDS, NO_T2, "how does aurinko relate to maa", mode="auto",
                      semantic_fn=semantic_stub(["x.md"]), graph_fn=graph_stub(["maa.md"]))
    assert body["used_modes"] == ["keyword", "graph"]  # semantic absent, graph joined
    assert body["degraded_from"] == "semantic"  # the missing tier is still named


def test_semantic_mode_uses_vectors_alone_when_fresh():
    body = run_search(RECORDS, FRESH, "kuu", mode="semantic",
                      semantic_fn=semantic_stub(["kuu.md", "maa.md"]))
    assert body["used_modes"] == ["semantic"]
    assert body["degraded_from"] is None
    assert [h["path"] for h in body["hits"]] == ["kuu.md", "maa.md"]
    assert all(h["source"] == "semantic" for h in body["hits"])


def test_auto_fuses_keyword_and_semantic_when_fresh():
    body = run_search(RECORDS, FRESH, "aurinko", mode="auto",
                      semantic_fn=semantic_stub(["aurinko.md", "maa.md"]))
    assert body["used_modes"] == ["keyword", "semantic"]
    assert body["degraded_from"] is None
    assert body["hits"][0]["path"] == "aurinko.md"  # top of both rankings
    paths = [h["path"] for h in body["hits"]]
    assert "maa.md" in paths  # semantic-only recall surfaces
    assert len(paths) == len(set(paths))  # deduped by document
    assert all(h["source"] in ("keyword", "semantic") for h in body["hits"])


def test_semantic_failure_degrades_instead_of_erroring():
    for mode, used in (("semantic", ["keyword"]), ("auto", ["keyword"])):
        body = run_search(RECORDS, FRESH, "aurinko", mode=mode, semantic_fn=broken_semantic)
        assert body["used_modes"] == used
        assert body["degraded_from"] == "semantic"


def test_limit_caps_the_fused_set():
    body = run_search(RECORDS, FRESH, "aurinko kuu maa", mode="auto", limit=2,
                      semantic_fn=semantic_stub(["kuu.md", "maa.md", "aurinko.md"]))
    assert len(body["hits"]) <= 2
