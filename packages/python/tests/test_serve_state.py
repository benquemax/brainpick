"""ServeState: artifact loading, the delta ring + replay, broadcast, manifest rescans."""
import json

from brainpick.compile.pipeline import run_compile
from brainpick.config import load_config
from brainpick.serve.state import ServeState, resolve_doc, suggest_paths
from brainpick.serve.watcher import recompile_and_broadcast

from conftest import stage_t3_export

NEW_DOC = (
    "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n"
    "# Uusi\n\nNear [Kuu](kuu.md).\n"
)


def make_state(root):
    state = ServeState(root, load_config(root))
    state.load()
    return state


def drain(queue):
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    return events


def test_load_compiles_and_holds_artifacts(kotiaurinko):
    state = make_state(kotiaurinko)
    assert state.seq == 1
    assert state.graph["stats"]["docs"] == 10
    assert any(r["path"] == "kuu.md" for r in state.records)
    assert state.manifest["tiers"] == {"t1": "fresh", "t2": "off", "t3": "fresh"}


def test_kg_derived_by_default(kotiaurinko):
    state = make_state(kotiaurinko)  # zero config — the algorithmic backend derived T3
    assert state.kg is not None
    assert state.graph_fn() is not None
    assert state.manifest["tiers"]["t3"] == "fresh"


def test_kg_absent_when_graph_off(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text('[modules]\ngraph = "off"\n', encoding="utf-8")
    state = make_state(kotiaurinko)
    assert state.kg is None  # no T3 export → unavailable, and graph_fn signals it
    assert state.graph_fn() is None
    assert state.manifest["tiers"]["t3"] == "off"


def test_empty_export_serves_but_graph_fn_degrades(kotiaurinko):
    """A brain with no ghosts and no tags derives an EMPTY export: the kg loads
    (the entity layer serves empty, spec/40) but graph_fn is None — a zero-entity
    walk answers nothing, so mode=graph degrades to the link walk instead."""
    for doc in kotiaurinko.rglob("*.md"):
        text = doc.read_text(encoding="utf-8")
        doc.write_text("\n".join(line for line in text.splitlines()
                                  if not line.startswith("tags:")) + "\n", encoding="utf-8")
    (kotiaurinko / "saaret" / "laguuni.md").write_text(
        "---\ntype: Concept\ntitle: Laguuni\n---\n\n# Laguuni\n\nHeld by the [Atolli](atolli.md).\n",
        encoding="utf-8",
    )  # drop the olematon ghost too
    state = make_state(kotiaurinko)
    assert state.manifest["tiers"]["t3"] == "fresh"  # empty is still fresh (spec/40)
    assert state.kg is not None and state.kg.entities == {}
    assert state.kg.entity_graph() == {"nodes": [], "edges": []}
    assert state.graph_fn() is None


def test_kg_loads_from_staged_export(kotiaurinko):
    state = make_state(kotiaurinko)
    stage_t3_export(kotiaurinko)
    state.reload_artifacts()  # re-read: the flipped manifest + the staged export
    assert state.kg is not None
    assert state.manifest["tiers"]["t3"] == "fresh"
    run = state.graph_fn()
    hits = run("vuorovesi", 8)
    assert {h["path"] for h in hits} == {"kuu.md", "aurinko.md", "maa.md"}
    assert all(h["source"] == "graph" for h in hits)


def test_apply_compile_result_updates_state_and_ring(kotiaurinko):
    state = make_state(kotiaurinko)
    (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
    state.apply_compile_result(run_compile(kotiaurinko))
    assert state.seq == 2
    assert [seq for seq, _ in state.ring] == [2]
    assert any(n["id"] == "uusi.md" for n in state.graph["nodes"])


def test_recompile_and_broadcast_event_order(kotiaurinko):
    state = make_state(kotiaurinko)
    queue = state.subscribe()
    (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
    result = recompile_and_broadcast(state)
    assert result.changed is True
    events = drain(queue)
    assert [name for name, _, _ in events] == ["compile.status", "graph.delta", "compile.status"]
    running, delta, done = (json.loads(data) for _, _, data in events)
    assert running == {"seq": 2, "state": "running", "tier": "t1"}
    assert done == {"seq": 2, "state": "done", "tier": "t1"}
    assert delta["seq"] == 2
    assert delta["cause"]["paths"] == ["index.md", "uusi.md"]
    assert events[1][1] == 2  # the SSE id equals seq


def test_noop_recompile_stays_silent(kotiaurinko):
    state = make_state(kotiaurinko)
    queue = state.subscribe()
    result = recompile_and_broadcast(state)
    assert result.changed is False
    assert drain(queue) == []
    assert state.seq == 1
    assert len(state.ring) == 0


def test_replay_contiguous_else_snapshot(kotiaurinko):
    state = make_state(kotiaurinko)
    (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
    state.apply_compile_result(run_compile(kotiaurinko))  # seq 2
    (kotiaurinko / "uusi.md").write_text(NEW_DOC + "\nMore rock.\n", encoding="utf-8")
    state.apply_compile_result(run_compile(kotiaurinko))  # seq 3

    replay = state.replay_events(1)
    assert [event_id for _, event_id, _ in replay] == [2, 3]
    assert state.replay_events(3) == []                    # nothing missed
    assert [e[1] for e in state.replay_events(2)] == [3]
    assert state.replay_events(0) is None                  # seq 1 predates the ring -> snapshot
    assert state.replay_events(99) is None                 # an id from the future -> snapshot


def test_rescan_from_manifest_emits_delta_for_foreign_compiles(kotiaurinko):
    state = make_state(kotiaurinko)
    queue = state.subscribe()
    (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
    run_compile(kotiaurinko)  # "another process" compiled behind our back
    state.rescan_from_manifest()
    assert state.seq == 2
    ((name, event_id, data),) = drain(queue)
    assert name == "graph.delta"
    assert event_id == 2
    delta = json.loads(data)
    assert "uusi.md" in delta["cause"]["paths"]
    assert any(n["id"] == "uusi.md" for n in delta["added"]["nodes"])
    # a second rescan without a newer manifest is a no-op
    state.rescan_from_manifest()
    assert drain(queue) == []


def test_suggest_paths_fuzzy(kotiaurinko):
    state = make_state(kotiaurinko)
    assert suggest_paths(state.records, "kuu")[0] == "kuu.md"
    assert suggest_paths(state.records, "atolli")[0] == "saaret/atolli.md"
    assert len(suggest_paths(state.records, "a")) <= 5


def test_resolve_doc_ladder():
    records = [
        {"path": "kuu.md", "title": "Kuu"},
        {"path": "saaret/atolli.md", "title": "Atolli"},
        {"path": "komeetta.md", "title": "Komeetta"},
    ]
    assert resolve_doc(records, "kuu.md") == ("ok", records[0])       # exact path
    assert resolve_doc(records, "kuu") == ("ok", records[0])          # path minus extension
    assert resolve_doc(records, "atolli") == ("ok", records[1])       # unique stem
    assert resolve_doc(records, "komeeta") == ("ok", records[2])      # fuzzy title typo
    status, suggestions = resolve_doc(records, "zzz-ei-ole")
    assert status == "miss"
    assert isinstance(suggestions, list)


def test_resolve_doc_ambiguous_stem():
    records = [
        {"path": "koru/helmi.md", "title": "Helmi koru"},
        {"path": "meri/helmi.md", "title": "Helmi meri"},
    ]
    status, candidates = resolve_doc(records, "helmi")
    assert status == "ambiguous"
    assert {c["path"] for c in candidates} == {"koru/helmi.md", "meri/helmi.md"}


# -- presentations (spec/95): brain_show resolves + broadcasts an ephemeral view ----


def test_present_resolves_docs_defaults_focus_and_broadcasts(kotiaurinko):
    state = make_state(kotiaurinko)
    queue = state.subscribe()
    presentation, dropped = state.present(nodes=["aurinko.md", "kuu"], annotation="the star")
    assert dropped == []
    assert presentation == {
        "annotation": "the star",
        "focus": "aurinko.md",              # defaults to the first resolved node
        "mode": None,
        "nodes": ["aurinko.md", "kuu.md"],  # "kuu" fuzzy-resolves like brain_read
        "seq": 1,
    }
    # broadcast as brain.show, and carries NO SSE id (so it never lands in the
    # delta ring / Last-Event-ID replay, spec/60)
    events = drain(queue)
    assert [name for name, _, _ in events] == ["brain.show"]
    name, event_id, data = events[0]
    assert event_id is None
    assert json.loads(data) == presentation
    assert list(state.ring) == []  # brain.show is excluded from the delta ring


def test_present_seq_is_monotonic_and_separate_from_manifest_seq(kotiaurinko):
    state = make_state(kotiaurinko)
    assert state.seq == 1
    first, _ = state.present(nodes=["aurinko.md"])
    second, _ = state.present(nodes=["maa.md"], mode="brain")
    assert (first["seq"], second["seq"]) == (1, 2)
    assert second["mode"] == "brain"
    assert state.seq == 1  # no compile, no delta — the manifest seq is untouched


def test_present_drops_unresolved_and_lists_them(kotiaurinko):
    state = make_state(kotiaurinko)
    presentation, dropped = state.present(nodes=["aurinko.md", "olematon-kappale"])
    assert presentation["nodes"] == ["aurinko.md"]
    assert dropped == ["olematon-kappale"]
    assert presentation["focus"] == "aurinko.md"


def test_present_resolves_entity_names_over_t3(kotiaurinko):
    state = make_state(kotiaurinko)
    stage_t3_export(kotiaurinko)
    state.reload_artifacts()
    presentation, dropped = state.present(nodes=["Vuorovesi", "kuu.md"], focus="maa")
    assert dropped == []
    assert presentation["nodes"] == ["vuorovesi", "kuu.md"]  # entity slug + doc path
    assert presentation["focus"] == "maa.md"                 # explicit focus resolves too


def test_present_clear_and_empty_call_broadcast_the_cleared_shape(kotiaurinko):
    state = make_state(kotiaurinko)
    state.present(nodes=["aurinko.md"])            # seq 1
    cleared, dropped = state.present(clear=True)   # seq 2 — explicit clear
    assert dropped == []
    assert cleared == {"annotation": None, "focus": None, "mode": None, "nodes": [], "seq": 2}
    empty, _ = state.present()                     # seq 3 — an otherwise-empty call also clears
    assert empty == {"annotation": None, "focus": None, "mode": None, "nodes": [], "seq": 3}
    assert state.presentation == empty             # the held presentation is the latest


def test_present_deduplicates_and_ignores_blank_tokens(kotiaurinko):
    state = make_state(kotiaurinko)
    presentation, dropped = state.present(nodes=["aurinko.md", "aurinko", "", "  "])
    assert presentation["nodes"] == ["aurinko.md"]  # "aurinko" stems to the same id, blanks ignored
    assert dropped == []
