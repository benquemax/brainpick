"""The REST surface (spec/50): JSON everywhere, instructive errors, ETag'd graph."""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from brainpick import SPEC_VERSION, __version__
from brainpick.auth import clear_session_cookie_header, session_cookie_header, verify_password
from brainpick.core.frontmatter import split_frontmatter
from brainpick.query.router import run_search
from brainpick.serve.state import bfs_neighborhood, jsonable, suggest_paths


def _state(request: Request):
    return request.app.state.brainpick


async def health(request: Request) -> JSONResponse:
    return JSONResponse({
        "impl": "python", "name": "brainpick", "spec_version": SPEC_VERSION, "version": __version__,
    })


async def status(request: Request) -> JSONResponse:
    state = _state(request)
    stats = state.graph.get("stats", {})
    return JSONResponse({
        "seq": state.seq,
        "tiers": state.manifest.get("tiers", {}),
        "docs": stats.get("docs", 0),
        "edges": stats.get("edges", 0),
        "ghosts": stats.get("ghosts", 0),
        "orphans": stats.get("orphans", 0),
        "bundle_root": str(state.root),
        "watching": state.watching,
    })


async def graph(request: Request) -> Response:
    state = _state(request)
    layer = request.query_params.get("layer", "links")
    if layer == "entities" and state.kg is None:  # the instructive 404 wins over any cache
        return JSONResponse(
            {"error": "no entity layer yet — compile T3 (an extractor) to populate it"},
            status_code=404,
        )
    etag = f'"{state.seq}"'  # both layers version by manifest seq (spec/50)
    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        candidates = {value.strip().removeprefix("W/") for value in if_none_match.split(",")}
        if etag in candidates or "*" in candidates:
            return Response(status_code=304, headers={"ETag": etag})
    if layer == "entities":
        return JSONResponse(state.kg.entity_graph(), headers={"ETag": etag})
    return JSONResponse(state.graph, headers={"ETag": etag})


async def doc_detail(request: Request) -> JSONResponse:
    state = _state(request)
    path = request.path_params["path"]
    record = state.record_for(path)
    if record is None:
        return JSONResponse({
            "error": f"no document at '{path}' — the closest paths are listed under suggestions",
            "suggestions": suggest_paths(state.records, path),
        }, status_code=404)
    file_path = state.root / path
    if file_path.is_file():
        frontmatter, body = split_frontmatter(file_path.read_text(encoding="utf-8"))
    else:  # deleted since the last compile — serve the held record
        frontmatter = {k: record[k] for k in ("type", "title", "description", "tags", "timestamp")
                       if record.get(k)}
        body = record["text"]
    return JSONResponse({
        "path": path,
        "frontmatter": jsonable(frontmatter),
        "title": record["title"],
        "text": body,
        "neighbors": state.neighbors_of(path),
    })


async def search_endpoint(request: Request) -> JSONResponse:
    state = _state(request)
    query = request.query_params.get("q")
    if not query:
        return JSONResponse({"error": "add ?q=<words> — e.g. /api/search?q=aurinko"}, status_code=400)
    mode = request.query_params.get("mode", "auto")  # the router forgives unknown modes
    try:
        limit = max(1, min(int(request.query_params.get("limit", "8")), 50))
    except ValueError:
        limit = 8
    body = run_search(
        state.records, state.manifest.get("tiers", {}), query,
        mode=mode, limit=limit, semantic_fn=state.semantic_fn(),
        graph_fn=state.graph_fn(), link_graph=state.graph,
    )
    return JSONResponse(body)


async def neighbors_endpoint(request: Request) -> JSONResponse:
    state = _state(request)
    center = request.query_params.get("id")
    if not center:
        return JSONResponse(
            {"error": "add ?id=<doc path> — e.g. /api/neighbors?id=kuu.md"}, status_code=400,
        )
    node_ids = {node["id"] for node in state.graph["nodes"]}
    if center not in node_ids:
        return JSONResponse({
            "error": f"no node '{center}' in the graph — the closest paths are listed under suggestions",
            "suggestions": suggest_paths(state.records, center),
        }, status_code=404)
    try:
        depth = max(1, min(int(request.query_params.get("depth", "1")), 3))
    except ValueError:
        depth = 1
    layer = request.query_params.get("layer", "links")
    if layer not in ("links", "entities", "both"):
        layer = "links"
    want_entities = layer in ("entities", "both")
    want_links = layer in ("links", "both")
    tagged = layer == "both"

    body: dict = {"center": center, "nodes": [], "edges": []}
    if want_entities and state.kg is None:
        body["degraded_from"] = "entities"  # links until a T3 export, said out loud
        want_links, want_entities, tagged = True, False, False

    if want_links:
        distance, link_edges = bfs_neighborhood(state.graph, center, depth)
        link_nodes = [dict(node) for node in state.graph["nodes"] if node["id"] in distance]
        link_edges = [dict(edge) for edge in link_edges]
        if tagged:
            for node in link_nodes:
                node["layer"] = "links"
            for edge in link_edges:
                edge["layer"] = "links"
        body["nodes"] += link_nodes
        body["edges"] += link_edges
    if want_entities:
        entity_nodes, entity_edges = state.kg.neighbor_entities(center, depth)
        if tagged:
            for node in entity_nodes:
                node["layer"] = "entities"
            for edge in entity_edges:
                edge["layer"] = "entities"
        body["nodes"] += entity_nodes
        body["edges"] += entity_edges
    return JSONResponse(body)


async def login(request: Request) -> Response:
    """POST /api/login {password} → 204 + signed session cookie, 401 on mismatch (spec/50)."""
    store = request.app.state.auth.current()
    try:
        body = await request.json()
    except Exception:
        body = None
    password = body.get("password") if isinstance(body, dict) else None
    if not isinstance(password, str):
        return JSONResponse({"error": 'send JSON: {"password": "…"}'}, status_code=400)
    if store is None or store.password is None:
        return JSONResponse(
            {"error": "no password is set on this brain — set one first: brainpick password set"},
            status_code=400,
        )
    if not verify_password(store, password):
        return JSONResponse({"error": "wrong password — try again"}, status_code=401)
    response = Response(status_code=204)
    response.headers["Set-Cookie"] = session_cookie_header(store)
    return response


async def logout(request: Request) -> Response:
    """POST /api/logout — clears the session (spec/50); always succeeds."""
    response = Response(status_code=204)
    response.headers["Set-Cookie"] = clear_session_cookie_header()
    return response


async def api_not_found(request: Request) -> JSONResponse:
    return JSONResponse({
        "error": (
            f"no endpoint /api/{request.path_params['rest']} — see /api/health, /api/status, "
            "/api/graph, /api/docs/{path}, /api/search, /api/neighbors, /api/live"
        ),
    }, status_code=404)


def api_routes() -> list[Route]:
    return [
        Route("/api/health", health),
        Route("/api/status", status),
        Route("/api/graph", graph),
        Route("/api/docs/{path:path}", doc_detail),
        Route("/api/search", search_endpoint),
        Route("/api/neighbors", neighbors_endpoint),
        Route("/api/login", login, methods=["POST"]),
        Route("/api/logout", logout, methods=["POST"]),
    ]
