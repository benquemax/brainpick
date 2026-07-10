"""The AGENTS.md brain report (spec/20): deterministic render, sane hub ordering,
<=5 truncation, and marker apply/refresh with a stable hash stamp."""
from brainpick.compile.t1 import (
    REPORT_BEGIN_PREFIX,
    REPORT_END_MARKER,
    apply_report_section,
    render_report_block,
)

TIERS = {"t1": "fresh", "t2": "off", "t3": "off"}


def _node(node_id, title, inbound, outbound, reserved=False, orphan=False):
    return {
        "id": node_id, "title": title, "in": inbound, "out": outbound,
        "reserved": reserved, "orphan": orphan,
    }


def _graph(nodes, ghost_pairs=None, **stats):
    base = {"docs": len(nodes), "edges": 0, "tags": 0, "orphans": 0, "ghosts": len(ghost_pairs or [])}
    base.update(stats)
    return {"nodes": nodes, "stats": base, "ghosts": ghost_pairs or []}


def _body(block: str) -> str:
    start = block.index(" -->\n") + len(" -->\n")
    return block[start:block.rindex(REPORT_END_MARKER)]


def test_hubs_ranked_by_total_degree_then_path():
    graph = _graph([
        _node("a.md", "A", 1, 1),   # degree 2
        _node("b.md", "B", 4, 3),   # degree 7 — top
        _node("m.md", "M", 3, 2),   # degree 5, ties with n
        _node("n.md", "N", 2, 3),   # degree 5 — m sorts first (path)
    ])
    lines = render_report_block(graph, TIERS).splitlines()
    hubs = [line.strip() for line in lines if line.startswith("  - ")]
    assert hubs[:4] == [
        "- B (b.md) — 4/3",
        "- M (m.md) — 3/2",
        "- N (n.md) — 2/3",
        "- A (a.md) — 1/1",
    ]


def test_hubs_exclude_reserved_and_truncate_to_five():
    nodes = [_node(f"{i}.md", f"D{i}", 10 - i, 0) for i in range(7)]  # 7 knowledge docs
    nodes.append(_node("index.md", "Index", 99, 99, reserved=True))  # highest degree, excluded
    block = render_report_block(_graph(nodes), TIERS)
    hub_lines = [line for line in block.splitlines() if line.startswith("  - ") and "/" in line]
    assert len(hub_lines) == 5
    assert "index.md" not in block  # reserved navigation is never a hub


def test_orphans_truncate_with_a_more_note():
    nodes = [_node(f"o{i}.md", f"O{i}", 0, 0, orphan=True) for i in range(6)]
    block = render_report_block(_graph(nodes, orphans=6), TIERS)
    lines = block.splitlines()
    start = lines.index("- Orphans:")
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("- Top ghosts:"))
    orphan_lines = [line for line in lines[start + 1:end] if line.startswith("  - ")]
    assert len(orphan_lines) == 6                 # 5 shown + the truncation note
    assert orphan_lines[-1] == "  - …and 1 more"


def test_empty_hubs_and_orphans_say_none():
    block = render_report_block(_graph([]), TIERS)
    assert "- Top hubs (in/out):\n  - (none)" in block
    assert "- Orphans:\n  - (none)" in block
    assert "- Top ghosts:\n  - (none)" in block


def test_top_ghosts_ranked_by_reference_count_then_target():
    # b is referenced by 3 distinct docs, a by 2, c by 1 — count is DISTINCT
    # sources, so a duplicate (source, target) pair must not double-count.
    ghosts = [
        {"source": "x.md", "target": "b.md"},
        {"source": "y.md", "target": "b.md"},
        {"source": "z.md", "target": "b.md"},
        {"source": "x.md", "target": "a.md"},
        {"source": "y.md", "target": "a.md"},
        {"source": "x.md", "target": "c.md"},
    ]
    block = render_report_block(_graph([], ghost_pairs=ghosts), TIERS)
    lines = block.splitlines()
    start = lines.index("- Top ghosts:")
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("- Bundle root:"))
    ghost_lines = lines[start + 1:end]
    assert ghost_lines == [
        "  - b.md — 3 refs",
        "  - a.md — 2 refs",
        "  - c.md — 1 refs",
    ]


def test_top_ghosts_truncates_to_five():
    ghosts = [{"source": f"s{i}.md", "target": f"g{i}.md"} for i in range(7)]
    block = render_report_block(_graph([], ghost_pairs=ghosts), TIERS)
    lines = block.splitlines()
    start = lines.index("- Top ghosts:")
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("- Bundle root:"))
    ghost_lines = [line for line in lines[start + 1:end] if line.startswith("  - ")]
    assert len(ghost_lines) == 5


def test_counts_tiers_and_bundle_root_render():
    graph = _graph([_node("a.md", "A", 0, 1)], docs=3, edges=5, tags=2, orphans=1, ghosts=1)
    block = render_report_block(graph, {"t1": "fresh", "t2": "fresh", "t3": "off"}, "docs")
    assert "- Counts: 3 docs · 5 links · 2 tags · 1 orphans · 1 ghosts" in block
    assert "- Tiers: t1 fresh · t2 fresh · t3 off" in block
    assert "- Bundle root: docs" in block


def test_render_is_deterministic_and_hash_stamped():
    graph = _graph([_node("b.md", "B", 2, 1), _node("a.md", "A", 1, 1)])
    first = render_report_block(graph, TIERS)
    second = render_report_block(graph, TIERS)
    assert first == second  # deterministic
    stamp = first[len(REPORT_BEGIN_PREFIX):first.index(") -->")]
    from brainpick.core.canonical import sha256_hex
    assert stamp == sha256_hex(_body(first).encode("utf-8"))[:8]


def test_apply_only_touches_between_markers():
    block = render_report_block(_graph([_node("a.md", "A", 1, 1)]), TIERS)
    before = (
        "# AGENTS.md\n\nHand-written intro.\n\n"
        f"{REPORT_BEGIN_PREFIX}old00000) -->\nstale body\n{REPORT_END_MARKER}\n\n"
        "<!-- henxels:begin -->\ncontract\n<!-- henxels:end -->\n"
    )
    after = apply_report_section(before, block)
    assert after is not None
    assert "Hand-written intro." in after
    assert "<!-- henxels:begin -->\ncontract\n<!-- henxels:end -->" in after
    assert "stale body" not in after
    assert block in after


def test_apply_refuses_to_create_or_touch_unmarked_files():
    block = render_report_block(_graph([_node("a.md", "A", 1, 1)]), TIERS)
    assert apply_report_section(None, block) is None          # no file → never created
    assert apply_report_section("plain AGENTS.md\n", block) is None  # no markers → untouched


def test_apply_is_idempotent():
    block = render_report_block(_graph([_node("a.md", "A", 1, 1)]), TIERS)
    text = f"intro\n\n{REPORT_BEGIN_PREFIX}zzz) -->\nx\n{REPORT_END_MARKER}\nfooter\n"
    once = apply_report_section(text, block)
    twice = apply_report_section(once, block)
    assert once == twice
