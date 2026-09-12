"""MCP tool payloads (spec/70): budget shaping, forgiving resolution, guarded writes."""
import json
import os
import re
import subprocess

from brainpick.config import load_config
from brainpick.core.canonical import sha256_hex
from brainpick.llm import MockChat
from brainpick.mcp_server import (
    neighbors_payload,
    overview_payload,
    read_payload,
    search_payload,
    tokens_of,
    write_payload,
)
from brainpick.serve.state import ServeState

from conftest import isolate_user_bin, prepend_path, stage_fake_henxels, stage_t3_export

NEW_DOC = (
    "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n"
    "# Uusi kivi\n\nNear [Kuu](kuu.md).\n"
)
KUU_REWRITE = (
    "---\ntype: Concept\ntags: [kuu]\ntimestamp: 2026-06-15T08:30:00Z\n---\n\n"
    "# Kuu\n\nThe moon pulls the tides of [Maa](maa.md), rewritten.\n"
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


def test_overview_top_ghosts_is_the_write_next_queue(kotiaurinko):
    result = overview_payload(make_state(kotiaurinko))
    assert result["top_ghosts"] == [{"target": "olematon.md", "count": 1}]


def test_overview_similarity_gaps_open_count_zero_when_artifact_absent(kotiaurinko):
    result = overview_payload(make_state(kotiaurinko))
    assert result["similarity_gaps_open_count"] == 0


def test_overview_similarity_gaps_open_count_reads_the_artifact(kotiaurinko):
    state = make_state(kotiaurinko)  # compiles first (T2 off — no artifact yet)
    (kotiaurinko / ".brainpick" / "t1" / "similarity-gaps.json").write_text(
        json.dumps({"pairs": [
            {"a": "a.md", "b": "b.md", "score": 0.9, "status": "open"},
            {"a": "c.md", "b": "d.md", "score": 0.8, "status": "dismissed"},
        ], "threshold": 0.75, "max_pairs": 50}),
        encoding="utf-8",
    )
    assert overview_payload(state)["similarity_gaps_open_count"] == 1


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


def test_search_why_names_matched_terms_not_whole_query(kotiaurinko):
    """issue #2: a multi-word query must not claim the WHOLE query appears in a
    doc that only matched some of its terms. The 'why' names the tokens that
    actually occur, never a term (like 'banana') that appears nowhere."""
    result = search_payload(make_state(kotiaurinko), "aurinko komeetta banana")
    assert result["hits"], "expected keyword hits for a partially-matching query"
    for hit in result["hits"]:
        why = hit["why"]
        # never echo the full query, and never claim a non-existent term matched
        assert "aurinko komeetta banana" not in why
        assert "banana" not in why
        # a keyword-ish 'mentions' reason must quote the actual matched token(s)
        if "mentions" in why:
            assert "aurinko" in why or "komeetta" in why


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
    # graph = "off": no T3 export exists, so layer=entities degrades to links —
    # the algorithmic default would otherwise serve a real (derived) entity layer.
    (kotiaurinko / "brainpick.toml").write_text('[modules]\ngraph = "off"\n', encoding="utf-8")
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


def _state_with_t3(kotiaurinko):
    state = make_state(kotiaurinko)
    stage_t3_export(kotiaurinko)
    state.reload_artifacts()
    return state


def test_neighbors_entities_layer_over_staged_export(kotiaurinko):
    state = _state_with_t3(kotiaurinko)
    result = neighbors_payload(state, "kuu", layer="entities")  # forgiving stem resolution
    assert result["center"] == "kuu.md"
    assert result["degraded_from"] is None
    assert {n["id"] for n in result["nodes"]} == {"kuu", "maa", "vuorovesi", "planeetat"}
    kuu = next(n for n in result["nodes"] if n["id"] == "kuu")
    assert set(kuu) == {"id", "name", "description", "distance", "source_docs"}
    assert kuu["distance"] == 0
    grounding = {doc for node in result["nodes"] for doc in node["source_docs"]}
    assert grounding == {"aurinko.md", "kuu.md", "maa.md", "planeetat.md"}
    assert {"src": "kuu", "dst": "vuorovesi"} in result["edges"]


def test_neighbors_both_layer_overlays_tagged(kotiaurinko):
    state = _state_with_t3(kotiaurinko)
    result = neighbors_payload(state, "kuu.md", layer="both")
    assert result["degraded_from"] is None
    assert {n["layer"] for n in result["nodes"]} == {"links", "entities"}
    # link nodes carry a doc path, entity nodes an id — overlaid, not merged
    assert any(n["layer"] == "links" and "path" in n for n in result["nodes"])
    assert any(n["layer"] == "entities" and "id" in n for n in result["nodes"])


def test_search_graph_mode_over_staged_export(kotiaurinko):
    state = _state_with_t3(kotiaurinko)
    result = search_payload(state, "what orbits the star", mode="graph", limit=4)
    assert {h["path"] for h in result["hits"]} == {
        "aurinko.md", "komeetta.md", "maa.md", "planeetat.md",
    }
    assert result["used_modes"] == ["graph"]
    assert result["degraded_from"] is None
    assert all("entity graph" in h["why"] for h in result["hits"])


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
    bin_dir = stage_fake_henxels(tmp_path / "bin", "kebab-case or bust")
    monkeypatch.setenv("PATH", prepend_path(os.environ["PATH"], bin_dir))
    state = make_state(kotiaurinko)

    created = write_payload(state, "uusi.md", "# X\n")
    assert created["ok"] is False
    assert created["instruction"].strip() == "kebab-case or bust"
    assert not (kotiaurinko / "uusi.md").exists()          # created file rolled back

    replaced = write_payload(state, "kuu.md", "# Kuu\n\nClobbered.\n", mode="replace")
    assert replaced["ok"] is False
    assert "tides" in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")  # bytes restored
    assert state.seq == 1


# -- brain_write optimistic concurrency (spec/70 base_sha) --------------------------


def test_write_stale_base_sha_conflicts_without_writing(kotiaurinko):
    state = make_state(kotiaurinko)
    before = (kotiaurinko / "kuu.md").read_text(encoding="utf-8")
    result = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace", base_sha="0" * 64)
    assert result["ok"] is False
    assert result["conflict"] is True
    assert result["current_sha"] == sha256_hex(before.encode("utf-8"))
    assert result["theirs"] == before
    assert "re-read" in result["instruction"]
    assert "merged" not in result  # no git base, no model → the manual path
    assert (kotiaurinko / "kuu.md").read_text(encoding="utf-8") == before  # MUST NOT write
    assert state.seq == 1


def test_write_matching_base_sha_writes_normally(kotiaurinko):
    state = make_state(kotiaurinko)
    sha = sha256_hex((kotiaurinko / "kuu.md").read_bytes())
    result = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace", base_sha=sha)
    assert result["ok"] is True
    assert result["seq"] == 2
    assert "rewritten" in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")


def test_write_conflict_retry_with_current_sha_succeeds_and_bumps_seq(kotiaurinko):
    state = make_state(kotiaurinko)
    conflict = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace", base_sha="0" * 64)
    assert conflict["conflict"] is True
    assert state.seq == 1
    retry = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace",
                          base_sha=conflict["current_sha"])
    assert retry["ok"] is True
    assert retry["seq"] == 2
    assert state.seq == 2


def test_write_omitted_base_sha_keeps_last_write_wins(kotiaurinko):
    state = make_state(kotiaurinko)
    result = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace")
    assert result["ok"] is True  # today's behavior, untouched


def test_write_base_sha_on_a_deleted_doc_conflicts(kotiaurinko):
    state = make_state(kotiaurinko)
    result = write_payload(state, "poistettu.md", "# X\n", mode="replace", base_sha="a" * 64)
    assert result["ok"] is False
    assert result["conflict"] is True
    assert result["current_sha"] is None
    assert result["theirs"] == ""
    assert not (kotiaurinko / "poistettu.md").exists()


def test_write_conflict_merged_proposal_from_the_configured_model(kotiaurinko):
    (kotiaurinko / "brainpick.local.toml").write_text(
        '[models.extraction]\nkind = "mock"\n', encoding="utf-8",
    )
    state = make_state(kotiaurinko)
    result = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace", base_sha="0" * 64)
    assert result["conflict"] is True
    assert result["merged"]["strategy"] == "llm"  # no git base → the two-input model merge
    assert result["merged"]["content"] == KUU_REWRITE  # MockChat echoes the YOURS section
    assert "proposal" in result["hint"]
    assert "rewritten" not in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")  # never applied


def test_write_conflict_insane_model_output_omits_merged(kotiaurinko, monkeypatch):
    monkeypatch.setattr("brainpick.mcp_server.make_chat",
                        lambda *_a, **_k: MockChat(reply="<<<<<<< broken\n"))
    state = make_state(kotiaurinko)
    result = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace", base_sha="0" * 64)
    assert result["conflict"] is True
    assert "merged" not in result  # the sanity gate held — manual path


def test_write_conflict_three_way_from_a_git_base(kotiaurinko):
    def git(*args):
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false",
             "-c", "core.autocrlf=false",  # deterministic blobs on Windows runners
             *args],
            cwd=kotiaurinko, check=True, capture_output=True,
        )

    git("init", "-q")
    git("add", "-A")
    git("commit", "-qm", "base")
    base_bytes = (kotiaurinko / "kuu.md").read_bytes()
    base_text = base_bytes.decode("utf-8")

    # A foreign writer edits the tides line after our writer read the doc.
    theirs = base_text.replace(
        "The moon pulls the tides of [Maa](maa.md).",
        "The moon pulls the spring tides of [Maa](maa.md).",
    )
    # newline="\n": Windows text-mode would rewrite every \n as CRLF, making
    # EVERY line differ from the LF git base — the three-way then sees total
    # overlap and rightly declines. (Real CRLF forks degrade to llm/manual by
    # design; this test exercises the clean-fork path.)
    (kotiaurinko / "kuu.md").write_text(theirs, encoding="utf-8", newline="\n")

    state = make_state(kotiaurinko)
    yours = base_text + "\n## Vaiheet\n\nNew moon, then full moon.\n"
    result = write_payload(state, "kuu.md", yours, mode="replace",
                           base_sha=sha256_hex(base_bytes))
    assert result["conflict"] is True
    assert result["merged"]["strategy"] == "three-way"  # git HEAD supplied the verified base
    assert "spring tides" in result["merged"]["content"]  # their edit survives
    assert "## Vaiheet" in result["merged"]["content"]    # your edit survives
    assert "## Vaiheet" not in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")  # proposal only


def test_write_conflict_budget_shapes_theirs(kotiaurinko):
    state = make_state(kotiaurinko)
    full = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace", base_sha="0" * 64)
    slim = write_payload(state, "kuu.md", KUU_REWRITE, mode="replace", base_sha="0" * 64,
                         budget_tokens=40)
    assert slim["truncated"] is True
    assert len(slim["theirs"]) < len(full["theirs"])
    assert slim["theirs"].endswith("…")
    assert slim["current_sha"] == full["current_sha"]  # the retry key is never trimmed


def test_write_henxels_missing_warns(kotiaurinko, monkeypatch, tmp_path):
    (kotiaurinko / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    empty = tmp_path / "emptybin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    isolate_user_bin(monkeypatch, tmp_path / "nohome")
    state = make_state(kotiaurinko)
    result = write_payload(state, "uusi-kivi.md", NEW_DOC)
    assert result["ok"] is True
    assert "warning" in result
    assert (kotiaurinko / "uusi-kivi.md").is_file()


def test_write_henxels_found_in_user_bin_when_path_is_stripped(kotiaurinko, monkeypatch, tmp_path):
    """A harness that spawns `brainpick mcp` with PATH=/usr/bin:/bin hides a
    `uv tool install henxels` (~/.local/bin) — the guard used to shrug and
    accept every write with a warning. It must look there itself."""
    (kotiaurinko / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    home = tmp_path / "home"
    stage_fake_henxels(home / ".local" / "bin", "found in user bin")
    empty = tmp_path / "emptybin"
    empty.mkdir()
    monkeypatch.setenv("PATH", str(empty))
    isolate_user_bin(monkeypatch, home)
    state = make_state(kotiaurinko)

    result = write_payload(state, "uusi-kivi.md", NEW_DOC)
    assert result["ok"] is False
    assert result["instruction"].strip() == "found in user bin"
    assert not (kotiaurinko / "uusi-kivi.md").exists()


def test_write_henxels_contract_at_repo_root_governs_bundle(monkeypatch, tmp_path):
    """The brain-template layout: henxels.yaml beside _brain/, not inside it.
    The guard used to look only at the bundle root, find nothing, and skip
    the referee entirely — every write passed. It must find the repo-root
    contract and run the check from there with a repo-relative path."""
    import shutil as _shutil
    from conftest import FIXTURE_BUNDLES

    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    bundle = repo / "_brain"
    _shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", bundle)
    (repo / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    if os.name == "nt":  # pragma: no cover - mirrors stage_fake_henxels
        (bin_dir / "henxels.bat").write_text("@echo off\r\necho %cd% %2\r\nexit /b 1\r\n")
    else:
        fake = bin_dir / "henxels"
        fake.write_text('#!/bin/sh\necho "$(pwd) $2"\nexit 1\n')
        fake.chmod(0o755)
    monkeypatch.setenv("PATH", prepend_path(os.environ["PATH"], bin_dir))
    state = make_state(bundle)

    result = write_payload(state, "uusi-kivi.md", NEW_DOC)
    assert result["ok"] is False
    cwd, _, checked = result["instruction"].strip().partition(" ")
    assert os.path.realpath(cwd) == os.path.realpath(repo)      # ran from the contract's dir
    assert checked.replace("\\", "/") == "_brain/uusi-kivi.md"  # repo-relative target
    assert not (bundle / "uusi-kivi.md").exists()


# -- brain_show (spec/95): the 6th tool — ephemeral presentations, not write-gated --


def _no_server(monkeypatch, reason="[Errno 111] Connection refused"):
    """Make brain_show's proxy attempt behave as if no `brainpick serve` is
    listening — every existing local-fallback test needs this so it doesn't
    silently depend on whatever happens to be bound to 127.0.0.1:4747 on the
    machine running the suite (spec/95 follow-up: the stdio MCP process has no
    server of its own to ask, so it must genuinely try one over HTTP first)."""
    def fake_post_show(base_url, body, token=None):
        return None, f"no brainpick server at {base_url} — start one with 'brainpick serve' ({reason})", True
    monkeypatch.setattr("brainpick.cli.post_show", fake_post_show)


def test_show_payload_reports_shown_dropped_seq_and_hint(kotiaurinko, monkeypatch):
    from brainpick.mcp_server import show_payload

    _no_server(monkeypatch)
    state = make_state(kotiaurinko)
    queue = state.subscribe()
    result = show_payload(state, nodes=["aurinko.md", "ei-ole"], annotation="hi")
    assert result["ok"] is True
    assert result["shown"] == 1
    assert result["dropped"] == ["ei-ole"]
    assert result["seq"] == 1
    # the exact hint — pinned so the Node twin stays byte-identical (cross-engine parity),
    # aside from the trailing no-server caveat (Python-only for now, see mcp_server.py)
    assert result["hint"] == (
        "showing 1 node(s) live in every open UI — "
        "call brain_show again to change it, or with clear:true to dismiss. (dropped 1: ei-ole)"
        " No brainpick serve is running for this bundle, so nothing is actually visible yet"
        " — start one with `brainpick serve --root <bundle>`."
    )
    # local fallback still updates its own (UI-less) state so the CLI/tests can introspect it
    assert [name for name, _, _ in drain(queue)] == ["brain.show"]
    assert state.seq == 1


def test_show_payload_clear_has_a_dedicated_hint(kotiaurinko, monkeypatch):
    from brainpick.mcp_server import show_payload

    _no_server(monkeypatch)
    state = make_state(kotiaurinko)
    result = show_payload(state, clear=True)
    assert result == {
        "ok": True, "shown": 0, "dropped": [], "seq": 1,
        "hint": ("cleared — every open UI dropped its spotlight and caption."
                 " No brainpick serve is running for this bundle, so nothing is actually visible yet"
                 " — start one with `brainpick serve --root <bundle>`."),
    }


def test_show_payload_proxies_to_a_running_server_and_never_touches_local_state(kotiaurinko, monkeypatch):
    """The actual bug fix: when a `brainpick serve` answers, brain_show must use
    ITS response (a real broadcast to a real UI) and leave the stdio process's
    own orphaned state untouched — no local seq bump, no local broadcast."""
    from brainpick.mcp_server import show_payload

    calls = []

    def fake_post_show(base_url, body, token=None):
        calls.append((base_url, body, token))
        return {"ok": True, "shown": 2, "dropped": [], "seq": 7}, None, False

    monkeypatch.setattr("brainpick.cli.post_show", fake_post_show)
    state = make_state(kotiaurinko)
    queue = state.subscribe()

    result = show_payload(state, nodes=["aurinko.md", "kuu"], annotation="hi", mode="brain")

    assert result == {
        "ok": True, "shown": 2, "dropped": [], "seq": 7,
        "hint": "showing 2 node(s) live in every open UI — "
                "call brain_show again to change it, or with clear:true to dismiss.",
    }
    assert len(calls) == 1
    base_url, body, token = calls[0]
    assert base_url == "http://127.0.0.1:4747"  # the bundle's default [serve] config
    assert body == {"nodes": ["aurinko.md", "kuu"], "annotation": "hi", "mode": "brain"}
    assert token is None  # no token configured for this fixture bundle
    # the orphaned local state was never touched — the real server did the broadcasting
    assert drain(queue) == []
    assert state.presentation_seq == 0


def test_show_payload_normalizes_a_wildcard_bind_to_a_connectable_host(kotiaurinko, monkeypatch):
    """A server can bind 0.0.0.0 (everywhere); a client can't connect TO that
    address — must resolve to 127.0.0.1 before POSTing, same as `brainpick show`."""
    from brainpick.config import load_config
    from brainpick.mcp_server import show_payload
    from brainpick.serve.state import ServeState

    calls = []
    monkeypatch.setattr(
        "brainpick.cli.post_show",
        lambda base_url, body, token=None: (calls.append(base_url), ({"ok": True, "shown": 0, "dropped": [], "seq": 1}, None, False))[1],
    )
    config = load_config(kotiaurinko)
    config.serve.host = "0.0.0.0"
    state = ServeState(kotiaurinko, config)
    state.load()

    show_payload(state, clear=True)

    assert calls == ["http://127.0.0.1:4747"]


def test_show_payload_reports_a_server_side_rejection_without_touching_local_state(kotiaurinko, monkeypatch):
    """A running server that REJECTS the presentation (e.g. a bad bearer token
    on a non-local bind) must surface as an error, never silently paper over it
    by falling back to updating the orphaned local state — that would hide a
    real misconfiguration behind a false 'ok'."""
    from brainpick.mcp_server import show_payload

    def fake_post_show(base_url, body, token=None):
        return None, "the server rejected the presentation (401): auth required", False

    monkeypatch.setattr("brainpick.cli.post_show", fake_post_show)
    state = make_state(kotiaurinko)
    queue = state.subscribe()

    result = show_payload(state, nodes=["aurinko.md"])

    assert result == {
        "ok": False, "dropped": [],
        "error": "the server rejected the presentation (401): auth required",
        "hint": "a brainpick serve is running but rejected the presentation — fix the error above, then try again.",
    }
    assert drain(queue) == []
    assert state.presentation_seq == 0


def test_brain_show_registered_as_sixth_tool_even_when_writes_refused(kotiaurinko):
    import asyncio

    from brainpick.mcp_server import create_mcp_server

    state = make_state(kotiaurinko)
    # write_refusal is set, yet brain_show is present — a presentation is not a write
    server = create_mcp_server(state, write_refusal="writes off")
    tools = asyncio.run(server.list_tools())
    assert {t.name for t in tools} == {
        "brain_overview", "brain_search", "brain_read",
        "brain_neighbors", "brain_write", "brain_show",
    }


def test_overview_update_notice_is_absent_without_one_and_leads_the_hint_with_one(kotiaurinko):
    state = make_state(kotiaurinko)
    plain = overview_payload(state)
    assert "update" not in plain
    state.update = {"current": "0.5.0", "latest": "0.6.0", "hint": "pip install -U brainpick"}
    noticed = overview_payload(state)
    assert noticed["update"] == state.update
    assert noticed["hint"].startswith("brainpick 0.6.0 is available (you run 0.5.0): pip install -U brainpick.")
