"""The REST surface (spec/50): JSON everywhere, instructive errors, ETag'd graph."""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from brainpick import SPEC_VERSION, __version__
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
    if layer == "entities":
        return JSONResponse(
            {"error": "layer=entities lands with T3 — use layer=links for now"}, status_code=404,
        )
    etag = f'"{state.seq}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        candidates = {value.strip().removeprefix("W/") for value in if_none_match.split(",")}
        if etag in candidates or "*" in candidates:
            return Response(status_code=304, headers={"ETag": etag})
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
    distance, edges = bfs_neighborhood(state.graph, center, depth)
    body = {
        "center": center,
        "nodes": [node for node in state.graph["nodes"] if node["id"] in distance],
        "edges": edges,
    }
    if layer in ("entities", "both"):
        body["degraded_from"] = "entities"  # links until T3, said out loud
    return JSONResponse(body)


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
    ]
