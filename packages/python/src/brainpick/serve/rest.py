"""The REST surface (spec/50): JSON everywhere, instructive errors, ETag'd graph."""
from __future__ import annotations

import json
import os
import re

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from brainpick import SPEC_VERSION, __version__
from brainpick.auth import (
    AUTH_REQUIRED_ERROR,
    auth_active,
    clear_session_cookie_header,
    session_cookie_header,
    verify_password,
)
from brainpick.core.canonical import sha256_hex
from brainpick.core.frontmatter import split_frontmatter
from brainpick.core.fs import atomic_write
from brainpick.mcp_server import guarded_write
from brainpick.query.router import run_search
from brainpick.serve.state import bfs_neighborhood, jsonable, suggest_paths

# Writing (spec/50): the browser editor's guarded doc-write + image-upload gate.
_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", ""}
WRITES_DISABLED_ERROR = 'writes are disabled — set [serve] writes = "guarded"'
_IMAGE_TYPES = {  # accepted content-type → canonical extension
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
    "image/gif": ".gif", "image/svg+xml": ".svg",
}
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
_ASSET_INVALID = re.compile(r"[^a-z0-9._-]+")


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


async def timeline(request: Request) -> Response:
    """GET /api/timeline (spec/90): the advisory t1/timeline.json, or the empty
    shape when the bundle has no git history. ETag by manifest seq, like graph."""
    state = _state(request)
    etag = f'"{state.seq}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match:
        candidates = {value.strip().removeprefix("W/") for value in if_none_match.split(",")}
        if etag in candidates or "*" in candidates:
            return Response(status_code=304, headers={"ETag": etag})
    path = state.root / ".brainpick" / "t1" / "timeline.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        payload = {"commits": [], "docs": {}, "span": None}
    return JSONResponse(payload, headers={"ETag": etag})


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


# -- writing (spec/50): the browser editor's guarded surface ------------------------


def _writes_gate(request: Request) -> JSONResponse | None:
    """spec/50: writes only when [serve] writes = "guarded" (else 403), and on a
    non-localhost bind only with a credential (else 401). When credentials exist
    the auth middleware has already gated; this closes the no-auth-file case."""
    config = _state(request).config
    if config.serve.writes != "guarded":
        return JSONResponse({"error": WRITES_DISABLED_ERROR}, status_code=403)
    if config.serve.host not in _LOCAL_HOSTS and not config.serve.token \
            and not auth_active(request.app.state.auth.current()):
        return JSONResponse({"error": AUTH_REQUIRED_ERROR}, status_code=401,
                            headers={"WWW-Authenticate": "Bearer"})
    return None


async def docs_write(request: Request) -> JSONResponse:
    """PUT /api/docs/{path} (spec/50): brain_write's HTTP face over the shared
    guarded_write core. Results map onto status codes; the 409 conflict is the
    same shape brain_write returns, merge proposal and all."""
    gate = _writes_gate(request)
    if gate is not None:
        return gate
    path = request.path_params["path"]
    if not path.endswith(".md"):
        return JSONResponse(
            {"ok": False, "instruction": "the editor writes .md docs — target a path ending in .md"},
            status_code=400,
        )
    try:
        body = await request.json()
    except Exception:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("content"), str):
        return JSONResponse(
            {"error": 'send JSON: {"content": "…", "base_sha"?: "…", "mode"?: "replace"}'},
            status_code=400,
        )
    base_sha = body["base_sha"] if isinstance(body.get("base_sha"), str) else None
    mode = body["mode"] if isinstance(body.get("mode"), str) else "replace"  # editor saves a full doc
    status, payload = guarded_write(_state(request), path, body["content"], mode, base_sha=base_sha)
    if status == "ok":
        return JSONResponse(
            {"ok": True, "path": payload["path"], "seq": payload["seq"], "sha": payload["sha"]},
            status_code=200,
        )
    if status == "badpath":
        return JSONResponse({"ok": False, "instruction": payload["instruction"]}, status_code=400)
    if status == "conflict":
        return JSONResponse(payload, status_code=409)
    # violation | exists → 422: the request was well-formed, the content/mode was not
    return JSONResponse({"ok": False, "instruction": payload["instruction"]}, status_code=422)


def _parse_multipart(body: bytes, content_type: str) -> dict:
    """Minimal multipart/form-data parse → {field: {filename, content_type, data}}.
    Enough for the single `file` (+ optional `name`) part POST /api/assets takes;
    no dependency, and the Node engine mirrors it byte for byte."""
    match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not match:
        return {}
    delim = b"--" + match.group(1).encode("latin-1")
    fields: dict = {}
    for chunk in body.split(delim):
        block = chunk
        if block.startswith(b"\r\n"):
            block = block[2:]
        if block.endswith(b"\r\n"):
            block = block[:-2]
        if not block or block == b"--":  # preamble / closing delimiter
            continue
        head, sep, data = block.partition(b"\r\n\r\n")
        if not sep:
            continue
        headers = head.decode("latin-1", errors="replace")
        name_m = re.search(r'name="([^"]*)"', headers)
        if not name_m:
            continue
        file_m = re.search(r'filename="([^"]*)"', headers)
        ctype_m = re.search(r"(?im)^content-type:\s*(.+?)\s*$", headers)
        fields[name_m.group(1)] = {
            "filename": file_m.group(1) if file_m else None,
            "content_type": ctype_m.group(1).strip() if ctype_m else "",
            "data": data,
        }
    return fields


def _sanitize_asset_name(raw: str, default_ext: str) -> str:
    """Kebab [a-z0-9._-], directory parts dropped (traversal can never escape
    assets/), collapsed dots so no hidden ".." survives (spec/50)."""
    base = str(raw or "").strip().lower().replace("\\", "/")
    base = base.rsplit("/", 1)[-1]
    base = _ASSET_INVALID.sub("-", base)
    base = re.sub(r"-{2,}", "-", base)
    base = re.sub(r"\.{2,}", ".", base)
    base = base.strip("-.")
    if not base:
        base = "asset"
    if "." not in base:
        base += default_ext
    return base


async def assets_upload(request: Request) -> JSONResponse:
    """POST /api/assets (spec/50): store an uploaded image under <bundle>/assets/
    and return its bundle-relative path for `![alt](assets/<name>)`. Same guard as
    doc writes; assets carry no .md, so the graph/index/timeline never see them."""
    gate = _writes_gate(request)
    if gate is not None:
        return gate
    state = _state(request)
    max_bytes = state.config.serve.max_asset_bytes
    fields = _parse_multipart(await request.body(), request.headers.get("content-type", ""))
    file_part = fields.get("file")
    if file_part is None:
        return JSONResponse({"error": "send multipart/form-data with a 'file' part"}, status_code=400)
    data = file_part["data"]
    ctype = (file_part["content_type"] or "").split(";")[0].strip().lower()
    name_field = fields.get("name")
    requested = name_field["data"].decode("utf-8", errors="replace").strip() if name_field else ""
    raw_name = requested or file_part["filename"] or ""
    ext = os.path.splitext(raw_name)[1].lower()
    if ctype not in _IMAGE_TYPES and ext not in _IMAGE_EXTS:
        return JSONResponse(
            {"error": "assets must be png, jpeg, webp, gif, or svg images"}, status_code=400)
    if len(data) > max_bytes:
        return JSONResponse(
            {"error": f"asset is {len(data)} bytes — the cap is {max_bytes} "
                      "(raise [serve] max_asset_bytes)"},
            status_code=413,
        )
    default_ext = _IMAGE_TYPES.get(ctype) or (ext if ext in _IMAGE_EXTS else ".png")
    name = _sanitize_asset_name(raw_name, default_ext)
    assets_dir = state.root / "assets"
    if not (assets_dir / name).resolve().is_relative_to(assets_dir.resolve()):
        return JSONResponse({"error": "asset name escapes assets/"}, status_code=400)
    sha = sha256_hex(data)
    target = assets_dir / name
    if not (target.is_file() and target.read_bytes() == data):  # identical bytes de-dupe
        if target.is_file():  # a different image already owns this name → hash-suffix it
            stem, dot, extn = name.rpartition(".")
            name = f"{stem}-{sha[:8]}.{extn}" if dot else f"{name}-{sha[:8]}"
            target = assets_dir / name
        if not (target.is_file() and target.read_bytes() == data):
            atomic_write(target, data)
    return JSONResponse({"path": f"assets/{name}", "sha": sha, "bytes": len(data)}, status_code=201)


def api_routes() -> list[Route]:
    return [
        Route("/api/health", health),
        Route("/api/status", status),
        Route("/api/graph", graph),
        Route("/api/timeline", timeline),
        Route("/api/docs/{path:path}", doc_detail),
        Route("/api/docs/{path:path}", docs_write, methods=["PUT"]),
        Route("/api/assets", assets_upload, methods=["POST"]),
        Route("/api/search", search_endpoint),
        Route("/api/neighbors", neighbors_endpoint),
        Route("/api/login", login, methods=["POST"]),
        Route("/api/logout", logout, methods=["POST"]),
    ]
