from brainpick.compile.t1 import build_docs_records, build_graph, render_index_block
from brainpick.core.bundle import scan


def graph_of(root):
    return build_graph(scan(root))


def test_graph_shape(kotiaurinko):
    g = graph_of(kotiaurinko)

    assert g["stats"] == {
        "docs": 10, "edges": 20, "ghosts": 1, "islands": 1, "orphans": 1, "tags": 8,
    }

    nodes = {n["id"]: n for n in g["nodes"]}
    assert [n["id"] for n in g["nodes"]] == sorted(nodes)  # sorted by id

    # orphan: only inbound is from reserved index.md
    assert nodes["yksinainen.md"]["orphan"] is True
    assert sum(n["orphan"] for n in g["nodes"]) == 1

    # degree bookkeeping (index links count for in/out, not orphanhood)
    assert nodes["aurinko.md"]["in"] == 4 and nodes["aurinko.md"]["out"] == 3
    assert nodes["komeetta.md"]["orphan"] is False  # aurinko links back to its comet
    assert nodes["komeetta.md"]["out"] == 1  # two links to aurinko collapse to one edge
    assert nodes["index.md"]["out"] == 8 and nodes["index.md"]["reserved"] is True

    # duplicate links collapse with count
    edge = next(e for e in g["edges"] if e["source"] == "komeetta.md")
    assert edge["target"] == "aurinko.md" and edge["count"] == 2 and edge["kind"] == "link"

    # islands: the saaret pair, mainland not listed
    assert g["islands"] == [["saaret/atolli.md", "saaret/laguuni.md"]]

    # ghosts
    assert g["ghosts"] == [{"source": "saaret/laguuni.md", "target": "olematon.md"}]

    # tag map sorted keys and members
    assert g["tags"]["saari"] == ["saaret/atolli.md", "saaret/laguuni.md"]
    assert list(g["tags"]) == sorted(g["tags"])

    # about is nullable on nodes too — absent frontmatter yields None
    assert nodes["aurinko.md"]["about"] == "thing"
    assert nodes["maa.md"]["about"] == "place"
    assert nodes["kuu.md"]["about"] is None

    # edges sorted by (source, target, kind)
    keys = [(e["source"], e["target"], e["kind"]) for e in g["edges"]]
    assert keys == sorted(keys)


def test_docs_records(kotiaurinko):
    recs = build_docs_records(scan(kotiaurinko))
    paths = [r["path"] for r in recs]
    assert paths == sorted(paths)
    kuu = next(r for r in recs if r["path"] == "kuu.md")
    assert kuu["title"] == "Kuu" and kuu["description"] is None
    assert "tides" in kuu["text"] and "type: Concept" not in kuu["text"]
    assert set(kuu) == {
        "about", "description", "path", "reserved", "sha256", "tags", "text", "timestamp", "title", "type",
    }

    # about is nullable — absent frontmatter yields None, present flows through
    assert kuu["about"] is None
    aurinko = next(r for r in recs if r["path"] == "aurinko.md")
    assert aurinko["about"] == "thing"
    maa = next(r for r in recs if r["path"] == "maa.md")
    assert maa["about"] == "place"


def test_index_block_render(kotiaurinko):
    block = render_index_block(scan(kotiaurinko))
    lines = block.splitlines()

    assert lines[0].startswith("<!-- brainpick:begin index (hash:")
    assert lines[-1] == "<!-- brainpick:end index -->"
    assert "## concepts" in lines and "## saaret" in lines

    # reserved files never listed
    assert not any("index.md)" in ln or "log.md)" in ln for ln in lines)

    # entry format, description omitted when null
    assert "- [Aurinko](aurinko.md) — The star everything in this bundle orbits." in lines
    assert "- [Kuu](kuu.md)" in lines

    # entries sorted by title within group; groups ordered root-first
    ci = lines.index("## concepts")
    si = lines.index("## saaret")
    assert ci < si

    # stamp is stable across renders
    assert block == render_index_block(scan(kotiaurinko))
