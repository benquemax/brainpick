"""Whole-graph diffs (spec/60): correctness never depends on watcher fidelity."""
from __future__ import annotations


def _edge_key(edge: dict) -> tuple[str, str, str]:
    return (edge["source"], edge["target"], edge["kind"])


def diff_graphs(old: dict, new: dict) -> dict:
    old_nodes = {n["id"]: n for n in old["nodes"]}
    new_nodes = {n["id"]: n for n in new["nodes"]}

    added_nodes = [new_nodes[i] for i in sorted(new_nodes.keys() - old_nodes.keys())]
    removed_nodes = sorted(old_nodes.keys() - new_nodes.keys())
    updated_nodes = [
        new_nodes[i]
        for i in sorted(new_nodes.keys() & old_nodes.keys())
        if new_nodes[i] != old_nodes[i]
    ]

    old_edges = {_edge_key(e): e for e in old["edges"]}
    new_edges = {_edge_key(e): e for e in new["edges"]}

    added_edges = [new_edges[k] for k in sorted(new_edges.keys() - old_edges.keys())]
    removed_edges = [
        {"kind": k[2], "source": k[0], "target": k[1]}
        for k in sorted(old_edges.keys() - new_edges.keys())
    ]
    for key in sorted(new_edges.keys() & old_edges.keys()):
        if new_edges[key] != old_edges[key]:  # count/label changed: remove + add
            removed_edges.append({"kind": key[2], "source": key[0], "target": key[1]})
            added_edges.append(new_edges[key])
    added_edges.sort(key=_edge_key)
    removed_edges.sort(key=_edge_key)

    return {
        "added": {"edges": added_edges, "nodes": added_nodes},
        "removed": {"edges": removed_edges, "nodes": removed_nodes},
        "stats": new["stats"],
        "updated": {"nodes": updated_nodes},
    }
