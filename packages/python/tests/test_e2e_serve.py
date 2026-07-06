"""e2e: one process serving REST + live SSE + the web UI + /mcp (spec/50 + spec/60).

Request/response endpoints go through starlette's TestClient. The SSE tests run a
real uvicorn server on an ephemeral port instead: the httpx-1.x TestClient transport
only hands back a response once the ASGI app completes, which an endless event
stream never does — and a live socket is the honest test of a serve layer anyway.
"""
import contextlib
import json
import threading
import time

import httpx
import uvicorn
from starlette.testclient import TestClient

from brainpick.compile.pipeline import run_compile
from brainpick.config import load_config
from brainpick.serve.app import build_app
from brainpick.serve.live import sse_frame
from brainpick.serve.watcher import recompile_and_broadcast

from conftest import stage_t3_export

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
        assert body["tiers"] == {"t1": "fresh", "t2": "off", "t3": "off"}
        assert body["docs"] == 10
        assert body["ghosts"] == 1
        assert body["orphans"] == 1
        assert body["watching"] is False
        assert body["bundle_root"]
        assert body["edges"] > 0


def test_graph_etag_roundtrip(kotiaurinko):
    with TestClient(make_app(kotiaurinko)) as client:
        first = client.get("/api/graph")
        assert first.status_code == 200
        assert first.headers["etag"] == '"1"'
        assert first.json()["stats"]["docs"] == 10
        cached = client.get("/api/graph", headers={"If-None-Match": first.headers["etag"]})
        assert cached.status_code == 304
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
        assert set(body) == {"path", "frontmatter", "title", "text", "neighbors"}
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
        assert set(aurinko) == {"id", "name", "type", "description", "degree"}
        assert aurinko["type"] == "star" and aurinko["degree"] == 2
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
    with TestClient(make_app(kotiaurinko)) as client:  # no export staged
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
