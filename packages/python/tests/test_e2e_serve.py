"""e2e: one process serving REST + live SSE + the web UI + /mcp (spec/50 + spec/60).

Request/response endpoints go through starlette's TestClient. The SSE tests run a
real uvicorn server on an ephemeral port instead: the httpx-1.x TestClient transport
only hands back a response once the ASGI app completes, which an endless event
stream never does — and a live socket is the honest test of a serve layer anyway.
"""
import base64
import contextlib
import json
import os
import re
import subprocess
import threading
import time

import httpx
import uvicorn
from starlette.testclient import TestClient

from brainpick.compile.pipeline import run_compile
from brainpick.config import load_config
from brainpick.core.canonical import sha256_hex
from brainpick.serve.app import build_app
from brainpick.serve.live import sse_frame
from brainpick.serve.watcher import recompile_and_broadcast

from conftest import prepend_path, stage_fake_henxels, stage_t3_export

NEW_DOC = (
    "---\ntype: Concept\ntitle: Uusi\ndescription: New rock.\n---\n\n"
    "# Uusi\n\nNear [Kuu](kuu.md).\n"
)


def make_app(root, **serve_overrides):
    config = load_config(root)
    config.serve.watch = False
    for key, value in serve_overrides.items():
        setattr(config.serve, key, value)
    return build_app(root, config)


@contextlib.contextmanager
def running_server(app):
    """A real uvicorn server on an ephemeral port, torn down when the block ends."""
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 15
        while not server.started:
            if time.monotonic() > deadline:
                raise AssertionError("uvicorn did not start within 15s")
            time.sleep(0.01)
        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=15)


@contextlib.contextmanager
def open_live_stream(base_url, **kwargs):
    timeout = httpx.Timeout(10.0, read=30.0)
    with httpx.stream("GET", f"{base_url}/api/live", timeout=timeout, **kwargs) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        yield response.iter_lines()


def next_event(lines):
    """Read one SSE frame (events and comment-only pings alike) from an iter_lines stream."""
    event = {}
    for line in lines:
        if line == "":
            if event:
                return event
            continue
        if line.startswith(":"):
            event.setdefault("comment", line)
            continue
        key, _, value = line.partition(":")
        value = value.lstrip()
        if key == "data":
            event["data"] = event.get("data", "") + value
        else:
            event[key] = value
    raise AssertionError("SSE stream ended unexpectedly")


def wait_for_event(lines, name, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        event = next_event(lines)
        if event.get("event") == name:
            return event
    raise AssertionError(f"no '{name}' event within {timeout}s")


def test_sse_frame_format():
    assert sse_frame("graph.delta", 3, '{"seq":3}') == 'event: graph.delta\nid: 3\ndata: {"seq":3}\n\n'
    assert sse_frame("compile.status", None, "{}") == "event: compile.status\ndata: {}\n\n"


def test_health(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        assert client.get("/api/health").json() == {
            "impl": "python", "name": "brainpick", "spec_version": "0.1", "version": "0.1.0",
        }


def test_status(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        body = client.get("/api/status").json()
        assert body["seq"] == 1
        assert body["tiers"] == {"t1": "fresh", "t2": "off", "t3": "fresh"}  # t3: algorithmic default
        assert body["docs"] == 10
        assert body["ghosts"] == 1
        assert body["orphans"] == 1
        assert body["watching"] is False
        assert body["bundle_root"]
        assert body["writes"] is True  # default [serve] writes = "guarded" → editor shows Edit
        assert body["edges"] > 0
        assert body["id"] is None  # the fixture predates [bundle] id (spec/80)
        # [ui] policy reaches the client so it stops guessing from the GPU (spec/50, spec/80)
        assert body["ui"] == {"max_nodes_mobile": 8000, "default_mode": "cosmos"}


def test_status_ships_the_configured_bundle_id(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text(
        '[bundle]\nid = "abc123xyz987def456ghi0a"\n', encoding="utf-8",
    )
    with TestClient(make_app(kotiaurinko)) as client:
        assert client.get("/api/status").json()["id"] == "abc123xyz987def456ghi0a"


def test_status_ships_configured_ui(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text(
        '[ui]\nmax_nodes_mobile = 1200\ndefault_mode = "brain"\n', encoding="utf-8",
    )
    with TestClient(make_app(kotiaurinko)) as client:
        assert client.get("/api/status").json()["ui"] == {
            "max_nodes_mobile": 1200, "default_mode": "brain",
        }


def test_graph_etag_roundtrip(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        first = client.get("/api/graph")
        assert first.status_code == 200
        assert first.headers["etag"] == '"1"'
        assert first.json()["stats"]["docs"] == 10
        cached = client.get("/api/graph", headers={"If-None-Match": first.headers["etag"]})
        assert cached.status_code == 304
        # the algorithmic default derives an entity layer on every compile — it serves
        entities = client.get("/api/graph?layer=entities")
        assert entities.status_code == 200
        assert any(n["type"] == "ghost" for n in entities.json()["nodes"])


def test_entity_layer_404_only_when_the_export_is_truly_absent(kotiaurinko):
    # [modules] graph = "off" compiles no T3 export at all — only THEN does the
    # entity layer 404 (an empty-but-present export serves empty instead, spec/40)
    (kotiaurinko / "brainpick.toml").write_text('[modules]\ngraph = "off"\n', encoding="utf-8")
    with TestClient(make_app(kotiaurinko)) as client:
        entities = client.get("/api/graph?layer=entities")
        assert entities.status_code == 404
        assert "error" in entities.json()
        # the instructive 404 wins over a cache: a stale If-None-Match must not 304
        cached_entities = client.get("/api/graph?layer=entities", headers={"If-None-Match": '"1"'})
        assert cached_entities.status_code == 404


def test_timeline_empty_then_served(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        # the fixture copy is not a git repo → no timeline.json → the empty shape
        first = client.get("/api/timeline")
        assert first.status_code == 200
        assert first.headers["etag"] == '"1"'
        assert first.json() == {"commits": [], "docs": {}, "span": None}

        # once an advisory timeline.json exists, the endpoint serves it verbatim
        payload = {
            "commits": [{"added": ["a.md"], "author": "Tom", "date": "2026-07-02T20:41:00Z",
                         "deleted": [], "message": "Founding", "modified": [], "sha": "abc1234"}],
            "docs": {"a.md": {"created": "2026-07-02T20:41:00Z", "deleted": None, "modified": []}},
            "span": {"commits": 1, "first": "2026-07-02T20:41:00Z", "last": "2026-07-02T20:41:00Z"},
        }
        tl_path = kotiaurinko / ".brainpick" / "t1" / "timeline.json"
        tl_path.write_text(json.dumps(payload), encoding="utf-8")
        served = client.get("/api/timeline")
        assert served.status_code == 200
        assert served.headers["etag"] == '"1"'
        assert served.json() == payload

        # ETag by seq (spec/90): a matching If-None-Match short-circuits to 304
        cached = client.get("/api/timeline", headers={"If-None-Match": '"1"'})
        assert cached.status_code == 304


def test_docs_happy_and_nested(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        body = client.get("/api/docs/kuu.md").json()
        assert set(body) == {"path", "frontmatter", "title", "text", "sha", "neighbors"}
        assert len(body["sha"]) == 64  # sha256 of the raw file bytes — the editor's next base_sha
        assert body["title"] == "Kuu"
        assert body["frontmatter"]["type"] == "Concept"
        assert body["frontmatter"]["timestamp"] == "2026-06-15T08:30:00Z"
        assert "tides" in body["text"]
        assert {"path": "maa.md", "title": "Maa"} in body["neighbors"]["out"]
        assert "aurinko.md" in {n["path"] for n in body["neighbors"]["in"]}
        nested = client.get("/api/docs/saaret/atolli.md")
        assert nested.status_code == 200
        assert nested.json()["path"] == "saaret/atolli.md"


def test_docs_404_carries_suggestions(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        missing = client.get("/api/docs/kuu")
        assert missing.status_code == 404
        body = missing.json()
        assert "error" in body
        assert "kuu.md" in body["suggestions"]
        assert len(body["suggestions"]) <= 5


def test_search_keyword_set(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        body = client.get("/api/search", params={"q": "aurinko"}).json()
        assert {h["path"] for h in body["hits"]} == {
            "aurinko.md", "komeetta.md", "planeetat.md", "yksinainen.md",
        }
        assert set(body["hits"][0]) == {"path", "title", "description", "score", "snippet", "source"}
        assert body["used_modes"] == ["keyword"]
        assert body["degraded_from"] == "semantic"  # auto without T2 says so (spec/30)
        keyword = client.get("/api/search", params={"q": "aurinko", "mode": "keyword"}).json()
        assert keyword["degraded_from"] is None
        unknown_mode = client.get("/api/search", params={"q": "aurinko", "mode": "banana"})
        assert unknown_mode.status_code == 200
        assert unknown_mode.json()["used_modes"] == ["keyword"]
        semantic = client.get("/api/search", params={"q": "aurinko", "mode": "semantic"}).json()
        assert semantic["degraded_from"] == "semantic"
        assert client.get("/api/search").status_code == 400


def test_search_semantic_and_auto_with_mock_vectors(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text('[models.embedding]\nkind = "mock"\n',
                                                encoding="utf-8")
    with TestClient(make_app(kotiaurinko)) as client:
        assert client.get("/api/status").json()["tiers"]["t2"] == "fresh"

        semantic = client.get(
            "/api/search", params={"q": "kuu vuorovesi maa", "mode": "semantic"},
        ).json()
        assert semantic["used_modes"] == ["semantic"]
        assert semantic["degraded_from"] is None
        assert semantic["hits"]
        assert all(h["source"] == "semantic" for h in semantic["hits"])
        assert set(semantic["hits"][0]) == {
            "path", "title", "description", "score", "snippet", "source",
        }

        auto = client.get("/api/search", params={"q": "aurinko", "mode": "auto"}).json()
        assert auto["used_modes"] == ["keyword", "semantic"]
        assert auto["degraded_from"] is None
        paths = [h["path"] for h in auto["hits"]]
        assert "aurinko.md" in paths
        assert len(paths) == len(set(paths))  # RRF dedupes by document
        assert all(h["source"] in ("keyword", "semantic") for h in auto["hits"])


def test_neighbors_depth_semantics(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        one = client.get("/api/neighbors", params={"id": "maa.md"}).json()
        assert one["center"] == "maa.md"
        assert {n["id"] for n in one["nodes"]} == {"maa.md", "kuu.md", "planeetat.md", "index.md"}
        assert all({"source", "target", "kind", "count", "label"} <= set(e) for e in one["edges"])
        two = client.get("/api/neighbors", params={"id": "maa.md", "depth": 2}).json()
        assert {n["id"] for n in two["nodes"]} == {
            "maa.md", "kuu.md", "planeetat.md", "index.md", "aurinko.md",
            "komeetta.md", "yksinainen.md", "saaret/atolli.md", "saaret/laguuni.md",
        }
        missing = client.get("/api/neighbors", params={"id": "olematon.md"})
        assert missing.status_code == 404
        assert missing.json()["suggestions"]
        assert client.get("/api/neighbors").status_code == 400


def _serve_with_t3(kotiaurinko):
    """An app whose ServeState holds the staged T3 export (kg present, t3 fresh)."""
    app = make_app(kotiaurinko)  # build_app already ran state.load()
    stage_t3_export(kotiaurinko)
    app.state.brainpick.reload_artifacts()  # re-read the flipped manifest + the export
    return app


def test_t3_entity_graph_endpoint(kotiaurinko):
    app = _serve_with_t3(kotiaurinko)
    with TestClient(app) as client:
        assert client.get("/api/status").json()["tiers"]["t3"] == "fresh"

        response = client.get("/api/graph?layer=entities")
        assert response.status_code == 200
        assert response.headers["etag"] == '"1"'  # versioned by manifest seq, like layer=links
        payload = response.json()
        assert [n["id"] for n in payload["nodes"]] == [
            "aurinko", "komeetta", "kuu", "maa", "planeetat", "vuorovesi",
        ]
        aurinko = next(n for n in payload["nodes"] if n["id"] == "aurinko")
        assert set(aurinko) == {"id", "name", "type", "description", "degree", "source_docs"}
        assert aurinko["type"] == "star" and aurinko["degree"] == 2
        # source_docs (spec/50): the entity's provenance, sorted, so the entity panel
        # need not make N follow-up calls.
        assert aurinko["source_docs"] == ["aurinko.md", "komeetta.md", "planeetat.md"]
        assert {"src": "komeetta", "dst": "aurinko", "weight": 0.6} in payload["edges"]
        assert len(payload["edges"]) == 5

        cached = client.get("/api/graph?layer=entities", headers={"If-None-Match": '"1"'})
        assert cached.status_code == 304


def test_t3_neighbors_entities_and_both(kotiaurinko):
    app = _serve_with_t3(kotiaurinko)
    with TestClient(app) as client:
        entities = client.get("/api/neighbors", params={"id": "kuu.md", "layer": "entities"}).json()
        assert entities["center"] == "kuu.md"
        assert {n["id"] for n in entities["nodes"]} == {"kuu", "maa", "vuorovesi", "planeetat"}
        assert "degraded_from" not in entities  # T3 present — no degradation
        grounding = {doc for node in entities["nodes"] for doc in node["source_docs"]}
        assert grounding == {"aurinko.md", "kuu.md", "maa.md", "planeetat.md"}
        assert {"src": "kuu", "dst": "vuorovesi"} in entities["edges"]

        both = client.get("/api/neighbors", params={"id": "kuu.md", "layer": "both"}).json()
        assert {n["layer"] for n in both["nodes"]} == {"links", "entities"}
        assert {e["layer"] for e in both["edges"]} <= {"links", "entities"}
        # link nodes carry a doc title, entity nodes an entity name — overlaid, not merged
        assert any("title" in n and n["layer"] == "links" for n in both["nodes"])
        assert any("name" in n and n["layer"] == "entities" for n in both["nodes"])


def test_t3_graph_mode_search(kotiaurinko):
    app = _serve_with_t3(kotiaurinko)
    with TestClient(app) as client:
        orbits = client.get(
            "/api/search", params={"q": "what orbits the star", "mode": "graph", "limit": 4},
        ).json()
        assert {h["path"] for h in orbits["hits"]} == {
            "aurinko.md", "komeetta.md", "maa.md", "planeetat.md",
        }
        assert orbits["used_modes"] == ["graph"]
        assert orbits["degraded_from"] is None
        assert all(h["source"] == "graph" for h in orbits["hits"])

        # "vuorovesi" is in no document body — keyword finds nothing, graph expands
        vuorovesi = client.get("/api/search", params={"q": "vuorovesi", "mode": "graph"}).json()
        assert {h["path"] for h in vuorovesi["hits"]} == {"kuu.md", "aurinko.md", "maa.md"}


def test_graph_mode_degrades_without_t3(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text('[modules]\ngraph = "off"\n', encoding="utf-8")
    with TestClient(make_app(kotiaurinko)) as client:  # graph off — no export exists
        body = client.get("/api/search", params={"q": "aurinko", "mode": "graph"}).json()
        assert body["degraded_from"] == "graph"  # honest marker, keyword + T1 link-walk beneath
        assert "aurinko.md" in {h["path"] for h in body["hits"]}


def test_ui_and_spa_fallback(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        for path in ("/", "/graph/some-deep-link"):
            page = client.get(path)
            assert page.status_code == 200
            assert page.headers["content-type"].startswith("text/html")
        missing = client.get("/api/olematon")
        assert missing.status_code == 404
        assert "error" in missing.json()


def test_fallback_page_when_ui_unbuilt(kotiaurinko, monkeypatch):
    monkeypatch.setattr("brainpick.serve.app._resolve_ui_dir", lambda: None)
    with TestClient(make_app(kotiaurinko)) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "web UI" in page.text


def test_mcp_route_mounted_and_sse_optional(kotiaurinko):
    app = make_app(kotiaurinko)
    paths = {getattr(route, "path", None) for route in app.routes}
    assert "/mcp" in paths
    assert "/sse" not in paths
    both = make_app(kotiaurinko, transports=["streamable-http", "sse"])
    assert "/sse" in {getattr(route, "path", None) for route in both.routes}


def test_mcp_bearer_gate_on_nonlocal_bind(kotiaurinko):
    app = make_app(kotiaurinko, host="0.0.0.0", token="s3cret")
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200  # REST stays open
        denied = client.post("/mcp", json={})
        assert denied.status_code == 401
        allowed = client.post("/mcp", json={}, headers={"Authorization": "Bearer s3cret"})
        assert allowed.status_code != 401


# -- auth (spec/80 + spec/50): open by default; tokens gate /api and /mcp; the
# -- password gates the static UI behind a login page and a session cookie.

AUTH_401 = ("authentication required — send Authorization: Bearer <token> "
            "(create one: brainpick token create) or log in")


def test_auth_open_by_default_serves_everything(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        assert client.get("/api/status").status_code == 200
        assert client.post("/mcp", json={}).status_code != 401
        page = client.get("/")
        assert page.status_code == 200
        assert 'id="login"' not in page.text  # no password → no login page


def test_token_gates_api_and_mcp_until_revoked(kotiaurinko):
    from brainpick.auth import create_token, revoke_token

    with TestClient(make_app(kotiaurinko)) as client:
        token_id, secret = create_token(kotiaurinko, name="hermes")  # picked up live
        _, second_secret = create_token(kotiaurinko, name="vartija")

        denied = client.get("/api/status")
        assert denied.status_code == 401
        assert denied.headers["www-authenticate"] == "Bearer"
        assert denied.json() == {"error": AUTH_401}
        assert client.get("/api/status", headers={"Authorization": "Bearer bp_" + "0" * 32}) \
            .status_code == 401
        allowed = client.get("/api/status", headers={"Authorization": f"Bearer {secret}"})
        assert allowed.status_code == 200

        mcp_denied = client.post("/mcp", json={})
        assert mcp_denied.status_code == 401
        assert mcp_denied.json() == {"error": AUTH_401}
        mcp_allowed = client.post("/mcp", json={}, headers={"Authorization": f"Bearer {secret}"})
        assert mcp_allowed.status_code != 401

        page = client.get("/")  # tokens without a password never lock the UI (spec/80)
        assert page.status_code == 200
        assert 'id="login"' not in page.text

        revoke_token(kotiaurinko, token_id)  # a running server notices without a restart
        assert client.get("/api/status", headers={"Authorization": f"Bearer {secret}"}) \
            .status_code == 401
        assert client.get("/api/status", headers={"Authorization": f"Bearer {second_secret}"}) \
            .status_code == 200

        # revoking the LAST token reopens the brain — tokenless + passwordless
        # stays a first-class setup (spec/80), never a lock-out
        for record in list(app_tokens(kotiaurinko)):
            revoke_token(kotiaurinko, record["id"])
        assert client.get("/api/status").status_code == 200


def app_tokens(root):
    from brainpick.auth import list_tokens

    return list_tokens(root)


def test_live_stream_accepts_query_token(kotiaurinko):
    from brainpick.auth import create_token

    _, secret = create_token(kotiaurinko, name="event-source")
    app = make_app(kotiaurinko)
    with running_server(app) as base_url:
        denied = httpx.get(f"{base_url}/api/live")
        assert denied.status_code == 401
        assert denied.json() == {"error": AUTH_401}
        with open_live_stream(base_url, params={"token": secret}) as lines:
            assert next_event(lines)["event"] == "hello"  # EventSource cannot set headers
        assert httpx.get(f"{base_url}/api/live", params={"token": "bp_" + "f" * 32}) \
            .status_code == 401


def test_password_login_flow(kotiaurinko):
    from brainpick.auth import SESSION_COOKIE, set_password

    set_password(kotiaurinko, "kotiaurinko")
    with TestClient(make_app(kotiaurinko)) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert 'id="login"' in page.text  # spec/50: the login page, not the UI
        assert client.get("/graph/deep-link").text == page.text  # every static path asks
        assert client.get("/api/status").status_code == 401

        wrong = client.post("/api/login", json={"password": "väärä"})
        assert wrong.status_code == 401
        assert wrong.json() == {"error": "wrong password — try again"}
        assert client.post("/api/login", json={}).status_code == 400

        right = client.post("/api/login", json={"password": "kotiaurinko"})
        assert right.status_code == 204
        cookie = right.headers["set-cookie"]
        assert cookie.startswith(f"{SESSION_COOKIE}=")
        assert "HttpOnly" in cookie and "Max-Age=43200" in cookie  # 12 h session

        page = client.get("/")  # the TestClient jar now carries the session
        assert page.status_code == 200
        assert 'id="login"' not in page.text
        assert client.get("/api/status").status_code == 200  # the cookie opens /api too

        out = client.post("/api/logout")
        assert out.status_code == 204
        assert "Max-Age=0" in out.headers["set-cookie"]
        assert client.get("/api/status").status_code == 401
        assert 'id="login"' in client.get("/").text


def test_login_without_password_is_an_instruction(kotiaurinko):
    from brainpick.auth import create_token

    create_token(kotiaurinko)  # tokens only — the UI stays open, /api wants the token
    with TestClient(make_app(kotiaurinko)) as client:
        refused = client.post("/api/login", json={"password": "mikä tahansa"})
        assert refused.status_code == 400
        assert "brainpick password set" in refused.json()["error"]


def test_live_stream_delivers_deltas(kotiaurinko):
    app = make_app(kotiaurinko)
    with running_server(app) as base_url:
        state = app.state.brainpick
        with open_live_stream(base_url) as lines:
            hello = next_event(lines)
            assert hello["event"] == "hello"
            assert hello["id"] == "1"
            data = json.loads(hello["data"])
            assert data["seq"] == 1
            assert data["spec_version"] == "0.1"
            assert data["tiers"]["t1"] == "fresh"

            (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
            recompile_and_broadcast(state)  # the exact code path the watcher runs

            running = next_event(lines)
            assert running["event"] == "compile.status"
            assert json.loads(running["data"])["state"] == "running"
            delta = next_event(lines)
            assert delta["event"] == "graph.delta"
            assert delta["id"] == "2"
            payload = json.loads(delta["data"])
            assert payload["seq"] == 2
            assert payload["cause"]["paths"] == ["index.md", "uusi.md"]
            assert any(n["id"] == "uusi.md" for n in payload["added"]["nodes"])
            done = next_event(lines)
            assert json.loads(done["data"])["state"] == "done"


def test_live_replay_and_snapshot(kotiaurinko):
    app = make_app(kotiaurinko)
    with running_server(app) as base_url:
        state = app.state.brainpick
        (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
        recompile_and_broadcast(state)  # seq 2

        with open_live_stream(base_url, headers={"Last-Event-ID": "1"}) as lines:
            hello = next_event(lines)
            assert hello["event"] == "hello"
            assert hello["id"] == "2"
            replayed = next_event(lines)
            assert replayed["event"] == "graph.delta"
            assert replayed["id"] == "2"
            assert json.loads(replayed["data"])["seq"] == 2

        with open_live_stream(base_url, headers={"Last-Event-ID": "0"}) as lines:
            assert next_event(lines)["event"] == "hello"
            snapshot = next_event(lines)
            assert snapshot["event"] == "graph.snapshot"
            assert snapshot["id"] == "2"
            body = json.loads(snapshot["data"])
            assert body["seq"] == 2
            assert body["graph"]["stats"]["docs"] == 11


def test_watcher_end_to_end(kotiaurinko, monkeypatch):
    monkeypatch.setattr("brainpick.serve.live.PING_INTERVAL", 0.5)
    config = load_config(kotiaurinko)
    config.serve.watch = True
    app = build_app(kotiaurinko, config)
    with running_server(app) as base_url:
        assert httpx.get(f"{base_url}/api/status").json()["watching"] is True
        with open_live_stream(base_url) as lines:
            assert next_event(lines)["event"] == "hello"

            kuu = kotiaurinko / "kuu.md"
            kuu.write_text(kuu.read_text(encoding="utf-8") + "\nThe tides also breathe.\n",
                           encoding="utf-8")
            delta = wait_for_event(lines, "graph.delta")
            payload = json.loads(delta["data"])
            assert payload["seq"] == 2
            assert payload["cause"] == {"paths": ["kuu.md"], "tier": "t1"}

            # an out-of-process compile: the watcher notices the manifest seq move
            (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
            run_compile(kotiaurinko)
            second = wait_for_event(lines, "graph.delta")
            payload = json.loads(second["data"])
            assert payload["seq"] == 3
            assert "uusi.md" in payload["cause"]["paths"]


# -- guarded REST writes (spec/50): PUT /api/docs is brain_write's HTTP face --------
# The SAME guarded core backs both; these tests are the REST siblings of the
# brain_write conflict/rollback tests in test_mcp_tools.py.

KUU_REWRITE = (
    "---\ntype: Concept\ntags: [kuu]\ntimestamp: 2026-06-15T08:30:00Z\n---\n\n"
    "# Kuu\n\nThe moon pulls the tides of [Maa](maa.md), rewritten.\n"
)

# a 1x1 transparent PNG — a real image the asset endpoint accepts
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def drain(queue):
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    return events


def test_put_docs_writes_bumps_timestamp_returns_sha_and_fires_delta(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        state = app.state.brainpick
        queue = state.subscribe()
        assert "tides" in client.get("/api/docs/kuu.md").json()["text"]
        new = (
            "---\ntype: Concept\ntitle: Kuu\ndescription: The moon.\n---\n\n"
            "# Kuu\n\nThe moon, edited live in the browser [Maa](maa.md).\n"
        )
        resp = client.put("/api/docs/kuu.md", json={"content": new, "mode": "replace"})
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"ok": True, "path": "kuu.md", "seq": 2, "sha": body["sha"]}
        assert re.fullmatch(r"[0-9a-f]{64}", body["sha"])
        # the returned sha is the file's new content hash — the client's next base_sha
        assert body["sha"] == sha256_hex((kotiaurinko / "kuu.md").read_bytes())
        after = client.get("/api/docs/kuu.md").json()
        assert "edited live in the browser" in after["text"]
        disk = (kotiaurinko / "kuu.md").read_text(encoding="utf-8")
        assert re.search(r"^timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", disk, re.MULTILINE)
        assert "graph.delta" in [name for name, _, _ in drain(queue)]  # open UIs updated


def test_put_docs_henxels_violation_is_422_verbatim_and_rolls_back(kotiaurinko, monkeypatch, tmp_path):
    (kotiaurinko / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    bin_dir = stage_fake_henxels(tmp_path / "bin", "one concept per page")
    monkeypatch.setenv("PATH", prepend_path(os.environ["PATH"], bin_dir))
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        before = (kotiaurinko / "kuu.md").read_text(encoding="utf-8")
        resp = client.put("/api/docs/kuu.md", json={"content": "# Kuu\n\nClobbered.\n", "mode": "replace"})
        assert resp.status_code == 422  # well-formed request, contract rejected it
        body = resp.json()
        assert body["ok"] is False
        assert body["instruction"].strip() == "one concept per page"  # henxels output verbatim
        assert (kotiaurinko / "kuu.md").read_text(encoding="utf-8") == before  # rolled back


def test_put_docs_stale_base_sha_is_409_conflict_without_writing(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        before = (kotiaurinko / "kuu.md").read_text(encoding="utf-8")
        resp = client.put(
            "/api/docs/kuu.md",
            json={"content": KUU_REWRITE, "mode": "replace", "base_sha": "0" * 64},
        )
        assert resp.status_code == 409
        body = resp.json()
        assert body["ok"] is False
        assert body["conflict"] is True
        assert body["current_sha"] == sha256_hex(before.encode("utf-8"))
        assert body["theirs"] == before
        assert "re-read" in body["instruction"]
        assert "merged" not in body  # no git base, no model → the manual path
        assert (kotiaurinko / "kuu.md").read_text(encoding="utf-8") == before  # MUST NOT write


def test_put_docs_conflict_offers_three_way_merged_from_git_base(kotiaurinko):
    def git(*args):
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", *args],
            cwd=kotiaurinko, check=True, capture_output=True,
        )

    git("init", "-q")
    git("add", "-A")
    git("commit", "-qm", "base")
    base_bytes = (kotiaurinko / "kuu.md").read_bytes()
    base_text = base_bytes.decode("utf-8")
    theirs = base_text.replace(
        "The moon pulls the tides of [Maa](maa.md).",
        "The moon pulls the spring tides of [Maa](maa.md).",
    )
    (kotiaurinko / "kuu.md").write_text(theirs, encoding="utf-8")
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        yours = base_text + "\n## Vaiheet\n\nNew moon, then full moon.\n"
        resp = client.put(
            "/api/docs/kuu.md",
            json={"content": yours, "mode": "replace", "base_sha": sha256_hex(base_bytes)},
        )
        assert resp.status_code == 409
        body = resp.json()
        assert body["conflict"] is True
        assert body["merged"]["strategy"] == "three-way"  # git HEAD is the verified base
        assert "spring tides" in body["merged"]["content"]  # their edit survives
        assert "## Vaiheet" in body["merged"]["content"]    # your edit survives
        assert "## Vaiheet" not in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")  # proposal only


def test_put_docs_create_mode_refuses_clobber(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        resp = client.put("/api/docs/kuu.md", json={"content": "# Kaappaus\n", "mode": "create"})
        assert resp.status_code == 422
        assert resp.json()["ok"] is False
        assert "replace" in resp.json()["instruction"]
        assert "tides" in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")


def test_put_docs_bad_path_is_400(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        # a non-.md target (spec/50)
        non_md = client.put("/api/docs/notes.txt", json={"content": "x"})
        assert non_md.status_code == 400
        # a path the guarded resolver rejects (backslash / traversal family) surfaces as 400
        traversal = client.put("/api/docs/foo\\bar.md", json={"content": "x"})
        assert traversal.status_code == 400
        non_kebab = client.put("/api/docs/Kuun Vaiheet.md", json={"content": "x"})
        assert non_kebab.status_code == 400
        assert not (kotiaurinko / "Kuun Vaiheet.md").exists()


def test_put_docs_writes_off_is_403(kotiaurinko):
    app = make_app(kotiaurinko, writes="off")
    with TestClient(app) as client:
        resp = client.put("/api/docs/uusi.md", json={"content": "# X\n"})
        assert resp.status_code == 403
        assert "writes are disabled" in resp.json()["error"]
        assert not (kotiaurinko / "uusi.md").exists()


def test_put_docs_nonlocal_bind_without_token_is_401(kotiaurinko):
    app = make_app(kotiaurinko, host="0.0.0.0")
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200  # reads stay open
        resp = client.put("/api/docs/uusi.md", json={"content": "# X\n"})
        assert resp.status_code == 401
        assert not (kotiaurinko / "uusi.md").exists()


# -- image assets (spec/50): POST /api/assets ---------------------------------------


def test_post_assets_stores_image_and_returns_201(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        resp = client.post("/api/assets", files={"file": ("Diagram One.png", PNG_1PX, "image/png")})
        assert resp.status_code == 201
        body = resp.json()
        assert body == {"path": "assets/diagram-one.png", "sha": sha256_hex(PNG_1PX), "bytes": len(PNG_1PX)}
        assert (kotiaurinko / "assets" / "diagram-one.png").read_bytes() == PNG_1PX


def test_post_assets_dedupes_identical_bytes(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        first = client.post("/api/assets", files={"file": ("logo.png", PNG_1PX, "image/png")}).json()
        second = client.post("/api/assets", files={"file": ("logo.png", PNG_1PX, "image/png")}).json()
        assert first["path"] == second["path"] == "assets/logo.png"
        assert [p.name for p in (kotiaurinko / "assets").iterdir()] == ["logo.png"]


def test_post_assets_hash_suffixes_different_bytes_same_name(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        first = client.post("/api/assets", files={"file": ("logo.png", PNG_1PX, "image/png")}).json()
        other = PNG_1PX + b"\x00extra"
        second = client.post("/api/assets", files={"file": ("logo.png", other, "image/png")}).json()
        assert first["path"] == "assets/logo.png"
        assert second["path"] != first["path"]
        assert second["path"].startswith("assets/logo-") and second["path"].endswith(".png")
        assert (kotiaurinko / second["path"]).read_bytes() == other


def test_post_assets_rejects_non_image(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        resp = client.post("/api/assets", files={"file": ("notes.txt", b"hello", "text/plain")})
        assert resp.status_code == 400
        assert not (kotiaurinko / "assets").exists()


def test_post_assets_rejects_oversized(kotiaurinko):
    app = make_app(kotiaurinko, max_asset_bytes=64)
    with TestClient(app) as client:
        big = PNG_1PX + b"\x00" * 400
        resp = client.post("/api/assets", files={"file": ("big.png", big, "image/png")})
        assert resp.status_code == 413
        assert not (kotiaurinko / "assets").exists()


def test_post_assets_traversal_name_cannot_escape_assets(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        resp = client.post(
            "/api/assets",
            files={"file": ("x.png", PNG_1PX, "image/png")},
            data={"name": "../../evil.png"},
        )
        assert resp.status_code == 201
        assert resp.json()["path"] == "assets/evil.png"  # directory parts dropped
        assert not (kotiaurinko.parent / "evil.png").exists()
        assert (kotiaurinko / "assets" / "evil.png").is_file()


def test_post_assets_writes_off_is_403(kotiaurinko):
    app = make_app(kotiaurinko, writes="off")
    with TestClient(app) as client:
        resp = client.post("/api/assets", files={"file": ("x.png", PNG_1PX, "image/png")})
        assert resp.status_code == 403
        assert not (kotiaurinko / "assets").exists()


def test_uploaded_asset_is_invisible_to_the_compile(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        client.post("/api/assets", files={"file": ("diagram.png", PNG_1PX, "image/png")})
    # assets/ holds no .md, so a compile never sees it (graph, docs, index)
    run_compile(kotiaurinko)
    graph = json.loads((kotiaurinko / ".brainpick" / "t1" / "graph.json").read_text(encoding="utf-8"))
    assert not any("assets/" in node["id"] for node in graph["nodes"])
    docs = (kotiaurinko / ".brainpick" / "t1" / "docs.jsonl").read_text(encoding="utf-8")
    assert "assets/" not in docs
    assert "assets/" not in (kotiaurinko / "index.md").read_text(encoding="utf-8")


# -- presentations (spec/95): POST /api/show + the brain.show live event ------------


def test_post_show_broadcasts_and_returns_the_shape(kotiaurinko):
    app = make_app(kotiaurinko)
    with TestClient(app) as client:
        state = app.state.brainpick
        queue = state.subscribe()
        resp = client.post("/api/show", json={
            "nodes": ["aurinko.md", "kuu", "ei-ole"], "annotation": "the star", "mode": "brain",
        })
        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "shown": 2, "dropped": ["ei-ole"], "seq": 1}
        # it went out on the live channel as brain.show — no manifest delta
        assert [name for name, _, _ in drain(queue)] == ["brain.show"]
        assert client.get("/api/status").json()["seq"] == 1  # manifest seq untouched


def test_post_show_is_not_write_gated(kotiaurinko):
    app = make_app(kotiaurinko, writes="off")  # writes disabled entirely
    with TestClient(app) as client:
        resp = client.post("/api/show", json={"nodes": ["aurinko.md"]})
        assert resp.status_code == 200  # a presentation is not a write
        assert resp.json()["shown"] == 1


def test_post_show_nonlocal_bind_without_credential_is_401(kotiaurinko):
    app = make_app(kotiaurinko, host="0.0.0.0")
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200  # reads stay open
        resp = client.post("/api/show", json={"nodes": ["aurinko.md"]})
        assert resp.status_code == 401


def test_live_stream_delivers_brain_show(kotiaurinko):
    app = make_app(kotiaurinko)
    with running_server(app) as base_url:
        with open_live_stream(base_url) as lines:
            assert next_event(lines)["event"] == "hello"
            resp = httpx.post(f"{base_url}/api/show",
                              json={"nodes": ["aurinko.md"], "annotation": "hi"})
            assert resp.json() == {"ok": True, "shown": 1, "dropped": [], "seq": 1}
            show = wait_for_event(lines, "brain.show")
            assert "id" not in show  # no SSE id — brain.show stays out of the ring buffer
            assert json.loads(show["data"]) == {
                "annotation": "hi", "focus": "aurinko.md", "mode": None,
                "nodes": ["aurinko.md"], "seq": 1,
            }


def test_brain_show_excluded_from_ring_and_replayed_to_joiners(kotiaurinko):
    app = make_app(kotiaurinko)
    with running_server(app) as base_url:
        state = app.state.brainpick
        httpx.post(f"{base_url}/api/show", json={"nodes": ["aurinko.md"], "annotation": "hi"})
        (kotiaurinko / "uusi.md").write_text(NEW_DOC, encoding="utf-8")
        recompile_and_broadcast(state)  # a real graph delta → seq 2 in the ring

        # a NEW client is replayed the latest presentation once, after the snapshot
        with open_live_stream(base_url) as lines:
            assert next_event(lines)["event"] == "hello"
            replayed = wait_for_event(lines, "brain.show")
            assert json.loads(replayed["data"])["annotation"] == "hi"

        # a Last-Event-ID reconnect replays graph deltas from the ring, THEN the
        # latest presentation — brain.show never rode the ring itself
        with open_live_stream(base_url, headers={"Last-Event-ID": "1"}) as lines:
            assert next_event(lines)["event"] == "hello"
            delta = next_event(lines)
            assert delta["event"] == "graph.delta"
            assert delta["id"] == "2"
            pres = next_event(lines)
            assert pres["event"] == "brain.show"
            assert "id" not in pres
            assert json.loads(pres["data"])["annotation"] == "hi"


def test_cleared_presentation_replays_as_the_empty_shape(kotiaurinko):
    app = make_app(kotiaurinko)
    with running_server(app) as base_url:
        httpx.post(f"{base_url}/api/show", json={"nodes": ["aurinko.md"]})
        httpx.post(f"{base_url}/api/show", json={"clear": True})
        with open_live_stream(base_url) as lines:
            assert next_event(lines)["event"] == "hello"
            replayed = wait_for_event(lines, "brain.show")
            assert json.loads(replayed["data"]) == {
                "annotation": None, "focus": None, "mode": None, "nodes": [], "seq": 2,
            }
