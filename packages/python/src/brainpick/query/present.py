"""Plain-text presenters for the CLI query mirrors (search/read/neighbors/overview).

The mirrors are thin: they call the very same payload builders the MCP tools and
REST use, then render for a human here. `--json` skips these entirely and prints
the raw payload — the same shape a machine gets over MCP.
"""
from __future__ import annotations

import json


def to_json(payload: dict) -> str:
    """The machine face: the payload verbatim, pretty-printed and UTF-8."""
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _counts_line(counts: dict) -> str:
    return (
        f"{counts.get('docs', 0)} docs · {counts.get('edges', 0)} links · "
        f"{counts.get('tags', 0)} tags · {counts.get('orphans', 0)} orphans · "
        f"{counts.get('ghosts', 0)} ghosts"
    )


def present_overview(payload: dict) -> str:
    lines = [
        f"brain: {payload.get('bundle', '')}",
        f"counts: {_counts_line(payload.get('counts', {}))}",
        "tiers: " + " · ".join(f"{k} {v}" for k, v in payload.get("tiers", {}).items()),
    ]
    for group in payload.get("tree", []):
        lines.append("")
        lines.append(f"{group['group']}/")
        for doc in group["docs"]:
            desc = f" — {doc['description']}" if doc.get("description") else ""
            lines.append(f"  {doc['path']}  {doc['title']}{desc}")
    if payload.get("truncated"):
        lines.append("")
        lines.append("(listing trimmed — pass --json or a bigger brain for the full tree)")
    return "\n".join(lines)


def present_search(payload: dict, query: str) -> str:
    hits = payload.get("hits", [])
    header = f"{len(hits)} hits for '{query}'"
    used = ", ".join(payload.get("used_modes", []))
    if used:
        header += f" (mode: {used})"
    if payload.get("degraded_from"):
        header += f" [degraded from {payload['degraded_from']}]"
    lines = [header]
    for hit in hits:
        desc = f" — {hit['description']}" if hit.get("description") else ""
        why = f"  ({hit['why']})" if hit.get("why") else ""
        lines.append(f"  {hit['path']}  {hit['title']}{desc}{why}")
    if not hits:
        lines.append("  (no hits — try `overview` for the whole brain)")
    return "\n".join(lines)


def _present_resolution_miss(payload: dict) -> str | None:
    """The disambiguation / not-found shapes shared by read and neighbors."""
    if "disambiguation" in payload:
        lines = ["several docs match — name one exactly:"]
        lines += [f"  {d['path']}  {d['title']}" for d in payload["disambiguation"]]
        return "\n".join(lines)
    if "error" in payload:
        lines = [payload["error"]]
        if payload.get("suggestions"):
            lines.append("did you mean:")
            lines += [f"  {s}" for s in payload["suggestions"]]
        return "\n".join(lines)
    return None


def present_read(payload: dict) -> str:
    miss = _present_resolution_miss(payload)
    if miss is not None:
        return miss
    frontmatter = payload.get("frontmatter") or {}
    title = frontmatter.get("title")
    heading = f"{payload['path']} — {title}" if title else payload["path"]
    lines = [heading, ""]
    lines.append((payload.get("content") or "").rstrip("\n"))
    neighbors = payload.get("neighbors", {})
    incoming = ", ".join(n["path"] for n in neighbors.get("in", []))
    outgoing = ", ".join(n["path"] for n in neighbors.get("out", []))
    if incoming or outgoing:
        lines.append("")
        lines.append(f"neighbors: in [{incoming}] out [{outgoing}]")
    if payload.get("truncated"):
        lines.append("")
        lines.append("(content trimmed — pass --json or read specific sections for the rest)")
    return "\n".join(lines)


def present_neighbors(payload: dict) -> str:
    miss = _present_resolution_miss(payload)
    if miss is not None:
        return miss
    header = f"neighbors of {payload['center']}"
    if payload.get("degraded_from"):
        header += f" [degraded from {payload['degraded_from']}]"
    lines = [header]
    others = [n for n in payload.get("nodes", []) if n["path"] != payload["center"]]
    for node in others:
        desc = f" — {node['description']}" if node.get("description") else ""
        lines.append(f"  d{node['distance']}  {node['path']}  {node['title']}{desc}")
    if not others:
        lines.append("  (no neighbors — an orphan, or nothing links here yet)")
    edges = payload.get("edges", [])
    if edges:
        lines.append("edges:")
        lines += [f"  {e['source']} → {e['target']} ({e['kind']})" for e in edges]
    return "\n".join(lines)
