"""MCP tool payloads (spec/70): budget shaping, forgiving resolution, guarded writes."""
import json
import os
import re

from brainpick.config import load_config
from brainpick.mcp_server import (
    neighbors_payload,
    overview_payload,
    read_payload,
    search_payload,
    tokens_of,
    write_payload,
)
from brainpick.serve.state import ServeState

NEW_DOC = (
    "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n"
    "# Uusi kivi\n\nNear [Kuu](kuu.md).\n"
)


def make_state(root):
    state = ServeState(root, load_config(root))
    state.load()
    return state


def tree_doc_count(result):
    return sum(len(group["docs"]) for group in result["tree"])


def drain(queue):
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    return events


def test_tokens_of_is_chars_over_four():
    payload = {"text": "a" * 400}
    assert tokens_of(payload) == len(json.dumps(payload, ensure_ascii=False)) // 4


def test_overview_counts_and_tree(kotiaurinko):
    result = overview_payload(make_state(kotiaurinko))
    assert result["counts"]["docs"] == 10
    assert result["counts"]["ghosts"] == 1
    assert result["bundle"] == "kotiaurinko"
    assert [g["group"] for g in result["tree"]] == ["concepts", "saaret"]
    assert result["truncated"] is False
    assert result["hint"]


def test_overview_budget_trims_tree(kotiaurinko):
    state = make_state(kotiaurinko)
    full = overview_payload(state)
    slim = overview_payload(state, budget_tokens=80)
    assert slim["truncated"] is True
    assert tree_doc_count(slim) < tree_doc_count(full)


def test_search_hits_have_why_not_bodies(kotiaurinko):
    result = search_payload(make_state(kotiaurinko), "aurinko")
    assert {h["path"] for h in result["hits"]} == {
        "aurinko.md", "komeetta.md", "planeetat.md", "yksinainen.md",
    }
    assert set(result["hits"][0]) == {"path", "title", "description", "score", "why"}
    assert result["used_modes"] == ["keyword"]
    assert result["degraded_from"] == "semantic"  # auto without T2 says so (spec/30)
    assert result["truncated"] is False


def test_search_budget_trims_hits(kotiaurinko):
    state = make_state(kotiaurinko)
    full = search_payload(state, "aurinko")
    slim = search_payload(state, "aurinko", budget_tokens=40)
    assert slim["truncated"] is True
    assert 1 <= len(slim["hits"]) < len(full["hits"])
    assert "budget" in slim["hint"]


def test_search_forgiving_modes(kotiaurinko):
    state = make_state(kotiaurinko)
    unknown = search_payload(state, "aurinko", mode="banana")
    assert unknown["used_modes"] == ["keyword"]
    assert unknown["degraded_from"] == "semantic"  # banana → auto → degraded without T2
    assert "fell back to auto" in unknown["hint"]
    keyword = search_payload(state, "aurinko", mode="keyword")
    assert keyword["degraded_from"] is None
    degraded = search_payload(state, "aurinko", mode="semantic")
    assert degraded["used_modes"] == ["keyword"]
    assert degraded["degraded_from"] == "semantic"


def test_search_semantic_hits_via_mock_vectors(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text('[models.embedding]\nkind = "mock"\n',
                                                encoding="utf-8")
    state = make_state(kotiaurinko)
    assert state.manifest["tiers"]["t2"] == "fresh"
    semantic = search_payload(state, "kuu vuorovesi maa", mode="semantic")
    assert semantic["used_modes"] == ["semantic"]
    assert semantic["degraded_from"] is None
    assert semantic["hits"]
    assert all(set(h) == {"path", "title", "description", "score", "why"}
               for h in semantic["hits"])
    fused = search_payload(state, "aurinko", mode="auto")
    assert fused["used_modes"] == ["keyword", "semantic"]
    assert fused["degraded_from"] is None


def test_read_resolution_ladder(kotiaurinko):
    state = make_state(kotiaurinko)
    assert read_payload(state, "kuu.md")["path"] == "kuu.md"
    assert read_payload(state, "kuu")["path"] == "kuu.md"            # stem
    assert read_payload(state, "komeeta")["path"] == "komeetta.md"   # fuzzy title
    missing = read_payload(state, "olematon-zzz")
    assert "error" in missing
    assert missing["suggestions"]


def test_read_disambiguation(kotiaurinko):
    for rel, title in (("koru/helmi.md", "Helmi koru"), ("meri/helmi.md", "Helmi meri")):
        target = kotiaurinko / rel
        target.parent.mkdir(exist_ok=True)
        target.write_text(
            f"---\ntype: Concept\ntitle: {title}\ndescription: A pearl.\n---\n\n"
            f"# {title}\n\nSee [Kuu](/kuu.md).\n",
            encoding="utf-8",
        )
    state = make_state(kotiaurinko)
    result = read_payload(state, "helmi")
    assert {c["path"] for c in result["disambiguation"]} == {"koru/helmi.md", "meri/helmi.md"}
    assert result["hint"]


def test_read_full_doc_shape(kotiaurinko):
    result = read_payload(make_state(kotiaurinko), "planeetat.md")
    assert result["truncated"] is False
    assert "Every world orbits" in result["content"]
    assert result["outline"] == ["# Planeetat"]
    assert result["frontmatter"]["type"] == "Concept"
    assert result["frontmatter"]["timestamp"] == "2026-06-01T00:00:00Z"
    assert {n["path"] for n in result["neighbors"]["out"]} == {"aurinko.md", "maa.md"}
    assert {n["path"] for n in result["neighbors"]["in"]} == {"aurinko.md", "index.md", "maa.md"}


def test_read_sections_and_budget(kotiaurinko):
    (kotiaurinko / "osiot.md").write_text(
        "---\ntype: Concept\ntitle: Osiot\ndescription: A sectioned doc.\n---\n\n"
        "# Osiot\n\nIntro, see [Kuu](kuu.md).\n\n"
        "## Alpha\n\n" + ("Alpha text. " * 120) + "\n\n"
        "## Beta\n\nBeta text.\n",
        encoding="utf-8",
    )
    state = make_state(kotiaurinko)
    full = read_payload(state, "osiot.md")
    assert full["outline"] == ["# Osiot", "## Alpha", "## Beta"]
    only_beta = read_payload(state, "osiot.md", sections=["Beta"])
    assert "Beta text." in only_beta["content"]
    assert "Alpha text." not in only_beta["content"]
    slim = read_payload(state, "osiot.md", budget_tokens=60)
    assert slim["truncated"] is True
    assert len(slim["content"]) < len(full["content"])
    assert "sections" in slim["hint"]


def test_neighbors_depth_and_degrade(kotiaurinko):
    state = make_state(kotiaurinko)
    one = neighbors_payload(state, "maa.md")
    assert one["center"] == "maa.md"
    assert {n["path"] for n in one["nodes"]} == {"maa.md", "kuu.md", "planeetat.md", "index.md"}
    (center,) = [n for n in one["nodes"] if n["path"] == "maa.md"]
    assert center["distance"] == 0
    two = neighbors_payload(state, "maa.md", depth=2)
    assert {n["path"] for n in two["nodes"]} >= {"aurinko.md", "saaret/atolli.md"}
    clamped = neighbors_payload(state, "maa.md", depth=9)  # forgiving: clamps to 3
    depth3 = neighbors_payload(state, "maa.md", depth=3)
    assert {n["path"] for n in clamped["nodes"]} == {n["path"] for n in depth3["nodes"]}
    degraded = neighbors_payload(state, "maa.md", layer="entities")
    assert degraded["degraded_from"] == "entities"
    assert degraded["edges"]
    assert all(set(e) == {"source", "target", "kind"} for e in degraded["edges"])


def test_write_rejects_traversal(kotiaurinko):
    state = make_state(kotiaurinko)
    result = write_payload(state, "../ulos.md", "# Ulos\n")
    assert result["ok"] is False
    assert "bundle" in result["instruction"]
    assert not (kotiaurinko.parent / "ulos.md").exists()


def test_write_rejects_non_kebab(kotiaurinko):
    state = make_state(kotiaurinko)
    result = write_payload(state, "Kuun Vaiheet.md", "# Kuun vaiheet\n")
    assert result["ok"] is False
    assert "kuun-vaiheet.md" in result["instruction"]
    assert not (kotiaurinko / "Kuun Vaiheet.md").exists()


def test_write_refuses_clobber_on_create(kotiaurinko):
    state = make_state(kotiaurinko)
    result = write_payload(state, "kuu.md", "# Kaappaus\n")
    assert result["ok"] is False
    assert "replace" in result["instruction"]
    assert "tides" in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")


def test_write_happy_path_bumps_seq_and_timestamp(kotiaurinko):
    state = make_state(kotiaurinko)
    queue = state.subscribe()
    result = write_payload(state, "uusi-kivi", NEW_DOC)
    assert result["ok"] is True
    assert result["path"] == "uusi-kivi.md"
    assert result["seq"] == 2
    assert state.seq == 2
    text = (kotiaurinko / "uusi-kivi.md").read_text(encoding="utf-8")
    assert re.search(r"^timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", text, re.MULTILINE)
    assert "graph.delta" in [name for name, _, _ in drain(queue)]  # went out the shared path
    assert "- [Uusi kivi](uusi-kivi.md)" in (kotiaurinko / "index.md").read_text(encoding="utf-8")


def test_write_append_section(kotiaurinko):
    state = make_state(kotiaurinko)
    result = write_payload(state, "kuu.md", "## Nousuvesi\n\nSpring tides.\n", mode="append_section")
    assert result["ok"] is True
    text = (kotiaurinko / "kuu.md").read_text(encoding="utf-8")
    assert "## Nousuvesi" in text
    assert "The moon pulls" in text  # the original body survives


def test_write_gate_refusal(kotiaurinko):
    state = make_state(kotiaurinko)
    result = write_payload(state, "uusi.md", "# X\n", refusal='writes are off — set [serve] writes = "guarded"')
    assert result["ok"] is False
    assert "guarded" in result["instruction"]
    assert not (kotiaurinko / "uusi.md").exists()


def test_write_henxels_violation_restores(kotiaurinko, monkeypatch, tmp_path):
    (kotiaurinko / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    fake = tmp_path / "bin" / "henxels"
    fake.parent.mkdir()
    fake.write_text("#!/bin/sh\necho 'kebab-case or bust'\nexit 1\n")
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fake.parent}:{os.environ['PATH']}")
    state = make_state(kotiaurinko)

    created = write_payload(state, "uusi.md", "# X\n")
    assert created["ok"] is False
    assert created["instruction"].strip() == "kebab-case or bust"
    assert not (kotiaurinko / "uusi.md").exists()          # created file rolled back

    replaced = write_payload(state, "kuu.md", "# Kuu\n\nClobbered.\n", mode="replace")
    assert replaced["ok"] is False
    assert "tides" in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")  # bytes restored
    assert state.seq == 1


def test_write_henxels_missing_warns(kotiaurinko, monkeypatch, tmp_path):
    (kotiaurinko / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    empty = tmp_path / "emptybin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    state = make_state(kotiaurinko)
    result = write_payload(state, "uusi-kivi.md", NEW_DOC)
    assert result["ok"] is True
    assert "warning" in result
    assert (kotiaurinko / "uusi-kivi.md").is_file()
