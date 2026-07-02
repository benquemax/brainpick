from brainpick.compile.t1 import build_graph
from brainpick.core.bundle import scan
from brainpick.deltas import diff_graphs


def test_diff_add_modify_remove(kotiaurinko):
    old = build_graph(scan(kotiaurinko))

    (kotiaurinko / "uusi.md").write_text(
        "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n# Uusi\n\nNear [Kuu](kuu.md).\n",
        encoding="utf-8",
    )
    (kotiaurinko / "komeetta.md").unlink()
    new = build_graph(scan(kotiaurinko))

    delta = diff_graphs(old, new)

    assert [n["id"] for n in delta["added"]["nodes"]] == ["uusi.md"]
    assert delta["removed"]["nodes"] == ["komeetta.md"]
    assert {"count": 1, "kind": "link", "label": "Kuu", "source": "uusi.md", "target": "kuu.md"} in (
        delta["added"]["edges"]
    )
    assert {"kind": "link", "source": "komeetta.md", "target": "aurinko.md"} in delta["removed"]["edges"]

    # kuu gained an inbound edge -> updated full node record
    updated_ids = [n["id"] for n in delta["updated"]["nodes"]]
    assert "kuu.md" in updated_ids
    assert delta["stats"] == new["stats"]


def test_identical_graphs_produce_empty_delta(kotiaurinko):
    g = build_graph(scan(kotiaurinko))
    delta = diff_graphs(g, g)
    assert delta["added"] == {"edges": [], "nodes": []}
    assert delta["removed"] == {"edges": [], "nodes": []}
    assert delta["updated"] == {"nodes": []}


def test_edge_count_change_is_remove_plus_add(kotiaurinko):
    old = build_graph(scan(kotiaurinko))
    text = (kotiaurinko / "kuu.md").read_text(encoding="utf-8")
    (kotiaurinko / "kuu.md").write_text(text + "\nAlso [Maa](maa.md) again.\n", encoding="utf-8")
    new = build_graph(scan(kotiaurinko))

    delta = diff_graphs(old, new)
    assert {"kind": "link", "source": "kuu.md", "target": "maa.md"} in delta["removed"]["edges"]
    added = next(e for e in delta["added"]["edges"] if e["source"] == "kuu.md")
    assert added["count"] == 2
