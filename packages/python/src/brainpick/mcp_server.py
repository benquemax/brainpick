"""MCP tools (spec/70): five verbs, small-model ergonomics, budgets, guarded writes.

The payload builders are plain functions over ServeState so they unit-test without
a transport; create_mcp_server() wraps them in a FastMCP for stdio and /mcp alike.
"""
from __future__ import annotations

import posixpath
import re
import shutil
import subprocess
from datetime import datetime, timezone

from brainpick.compile.pipeline import _atomic_write
from brainpick.compile.t1 import BEGIN_PREFIX, END_MARKER
from brainpick.core.bundle import ALWAYS_EXCLUDED_DIRS
from brainpick.core.canonical import sha256_hex
from brainpick.core.frontmatter import split_frontmatter
from brainpick.llm import make_chat
from brainpick.merge import find_base, resolve
from brainpick.query.router import KNOWN_MODES, run_search
from brainpick.serve.state import ServeState, bfs_neighborhood, jsonable, resolve_doc
from brainpick.serve.watcher import recompile_and_broadcast
WRITES_OFF_REFUSAL = (
    'writes are disabled here — set [serve] writes = "guarded" in brainpick.toml to enable brain_write'
)
CONFLICT_INSTRUCTION = (
    "the doc changed since you read it — re-read, reconcile, retry with the new base_sha"
)

_HEADING = re.compile(r"^(#{1,6}) +(.+?)\s*$")
_KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_TS_LINE = re.compile(r"^timestamp:.*$", re.MULTILINE)


def tokens_of(obj) -> int:
    """The budget yardstick: JSON characters / 4 (spec/70)."""
    import json

    return len(json.dumps(obj, ensure_ascii=False)) // 4


# -- brain_overview ----------------------------------------------------------------


def overview_payload(state: ServeState, budget_tokens: int | None = None) -> dict:
    budget = budget_tokens or 800
    stats = state.graph.get("stats", {})
    counts = {key: stats.get(key, 0) for key in ("docs", "edges", "tags", "orphans", "ghosts")}

    groups: dict[str, list[dict]] = {}
    for record in state.records:
        if record["reserved"]:
            continue
        groups.setdefault(posixpath.dirname(record["path"]), []).append(record)
    tree = []
    for directory, members in sorted(groups.items(), key=lambda kv: (kv[0] != "", kv[0])):
        docs = [
            {"path": m["path"], "title": m["title"], "description": m["description"]}
            for m in sorted(members, key=lambda m: (str(m["title"]), m["path"]))
        ]
        tree.append({"group": directory or "concepts", "docs": docs})

    result = {
        "bundle": state.root.name,
        "counts": counts,
        "tiers": state.manifest.get("tiers", {}),
        "tree": tree,
        "truncated": False,
        "hint": "brain_search finds docs by keyword; brain_read opens one by path, stem, or title.",
    }
    while tokens_of(result) > budget and any(group["docs"] for group in tree):
        next(group for group in reversed(tree) if group["docs"])["docs"].pop()
        result["truncated"] = True
    if result["truncated"]:
        result["tree"] = [group for group in tree if group["docs"]]
        result["hint"] = "tree trimmed to fit budget_tokens — raise it for the full listing."
    return result


# -- brain_search ------------------------------------------------------------------


def _why(hit: dict, query: str) -> str:
    lowered = query.lower()
    if lowered in str(hit["title"]).lower():
        return f"title matches '{query}'"
    if hit["description"] and lowered in hit["description"].lower():
        return f"description mentions '{query}'"
    if hit.get("source") == "semantic":
        return f"semantically close to '{query}'"
    if hit.get("source") == "graph":
        return f"connected in the entity graph to '{query}'"
    return f"body mentions '{query}'" if hit.get("snippet") else "keyword match"


def search_payload(state: ServeState, query: str, mode: str = "auto", limit: int = 8,
                   budget_tokens: int | None = None) -> dict:
    budget = budget_tokens or 1200
    requested = str(mode or "auto")
    note = None
    if requested not in KNOWN_MODES:
        note = f"unknown mode '{requested}' fell back to auto. "
        requested = "auto"
    try:
        limit = max(1, min(int(limit), 50))
    except (TypeError, ValueError):
        limit = 8

    body = run_search(
        state.records, state.manifest.get("tiers", {}), str(query or ""),
        mode=requested, limit=limit, semantic_fn=state.semantic_fn(),
        graph_fn=state.graph_fn(), link_graph=state.graph,
    )
    raw = body["hits"]
    hits = [
        {"path": h["path"], "title": h["title"], "description": h["description"],
         "score": h["score"], "why": _why(h, query)}
        for h in raw
    ]
    result = {
        "hits": hits,
        "used_modes": body["used_modes"],
        "degraded_from": body["degraded_from"],
        "truncated": False,
        "hint": "",
    }
    while tokens_of(result) > budget and len(hits) > 1:
        hits.pop()
        result["truncated"] = True
    if result["truncated"]:
        hint = f"{len(raw) - len(hits)} hits trimmed — raise budget_tokens or sharpen the query."
    elif hits:
        hint = f"brain_read '{hits[0]['path']}' opens the best hit."
    else:
        hint = "no hits — brain_overview lists every doc in the brain."
    result["hint"] = (note or "") + hint
    return result


# -- brain_read --------------------------------------------------------------------


def _load_doc(state: ServeState, record: dict) -> tuple[dict, str]:
    path = state.root / record["path"]
    if path.is_file():
        return split_frontmatter(path.read_text(encoding="utf-8"))
    meta = {k: record[k] for k in ("type", "title", "description", "tags", "timestamp") if record.get(k)}
    return meta, record["text"]


def _extract_sections(body: str, wanted: list[str]) -> str:
    wanted_l = {str(w).strip().lstrip("#").strip().lower() for w in wanted}
    kept: list[str] = []
    keep, level = False, 0
    for line in body.splitlines():
        match = _HEADING.match(line)
        if match:
            if match.group(2).strip().lower() in wanted_l:
                keep, level = True, len(match.group(1))
            elif keep and len(match.group(1)) <= level:
                keep = False
        if keep:
            kept.append(line)
    return "\n".join(kept).strip() + ("\n" if kept else "")


def read_payload(state: ServeState, doc: str, sections: list[str] | None = None,
                 budget_tokens: int | None = None) -> dict:
    budget = budget_tokens or 2000
    outcome, payload = resolve_doc(state.records, doc)
    if outcome == "ambiguous":
        return {
            "disambiguation": [{"path": r["path"], "title": r["title"]} for r in payload],
            "hint": "several docs match — call brain_read again with one exact path.",
        }
    if outcome == "miss":
        return {
            "error": f"nothing in the brain matches '{doc}'",
            "suggestions": payload,
            "hint": "try brain_search, or brain_overview for the full tree.",
        }

    record = payload
    frontmatter, body = _load_doc(state, record)
    outline = [line.rstrip() for line in body.splitlines() if _HEADING.match(line)]
    content = _extract_sections(body, sections) if sections else body
    result = {
        "path": record["path"],
        "frontmatter": jsonable(frontmatter),
        "outline": outline,
        "content": content,
        "neighbors": state.neighbors_of(record["path"]),
        "truncated": False,
        "hint": f"brain_neighbors '{record['path']}' walks the links around this doc.",
    }
    if tokens_of(result) > budget:
        overhead = tokens_of({**result, "content": ""})
        allowed = max(160, (budget - overhead) * 4)
        if len(content) > allowed:
            result["content"] = content[:allowed].rsplit(" ", 1)[0] + " …"
            result["truncated"] = True
            result["hint"] = "over budget_tokens — request sections=[…] from the outline for the rest."
    return result


# -- brain_neighbors ---------------------------------------------------------------


def _link_neighbors(state: ServeState, center: str, depth: int) -> tuple[list[dict], list[dict]]:
    """The T1 link layer: nearby docs {path,title,description,distance} + edges."""
    distance, raw_edges = bfs_neighborhood(state.graph, center, depth)
    info = {node["id"]: node for node in state.graph["nodes"]}
    nodes = [
        {"path": path, "title": info[path]["title"], "description": info[path]["description"],
         "distance": hops}
        for path, hops in sorted(distance.items(), key=lambda kv: (kv[1], kv[0]))
    ]
    edges = [{"source": e["source"], "target": e["target"], "kind": e["kind"]} for e in raw_edges]
    return nodes, edges


def _node_key(node: dict) -> str:
    return node.get("path") or node["id"]  # link nodes key on path, entity nodes on id


def neighbors_payload(state: ServeState, doc: str, depth: int = 1, layer: str = "links",
                      budget_tokens: int | None = None) -> dict:
    budget = budget_tokens or 800
    outcome, payload = resolve_doc(state.records, doc)
    if outcome == "ambiguous":
        return {
            "disambiguation": [{"path": r["path"], "title": r["title"]} for r in payload],
            "hint": "several docs match — call brain_neighbors again with one exact path.",
        }
    if outcome == "miss":
        return {
            "error": f"nothing in the brain matches '{doc}'",
            "suggestions": payload,
            "hint": "try brain_search first.",
        }
    center = payload["path"]

    try:
        depth = max(1, min(int(depth), 3))
    except (TypeError, ValueError):
        depth = 1
    layer = str(layer or "links")
    if layer not in ("links", "entities", "both"):
        layer = "links"  # forgiving enums (spec/70)
    want_entities = layer in ("entities", "both")
    want_links = layer in ("links", "both")
    tagged = layer == "both"

    note = None
    degraded_from = None
    nodes: list[dict] = []
    edges: list[dict] = []

    if want_entities and state.kg is None:
        # T3 absent: degrade to links, said out loud (spec/70 keeps this behavior)
        degraded_from = "entities"
        note = "the entities layer needs a T3 export — served links instead. "
        want_links = True
        want_entities = False
        tagged = False

    if want_links:
        link_nodes, link_edges = _link_neighbors(state, center, depth)
        if tagged:
            for node in link_nodes:
                node["layer"] = "links"
            for edge in link_edges:
                edge["layer"] = "links"
        nodes += link_nodes
        edges += link_edges
    if want_entities:
        entity_nodes, entity_edges = state.kg.neighbor_entities(center, depth)
        if tagged:
            for node in entity_nodes:
                node["layer"] = "entities"
            for edge in entity_edges:
                edge["layer"] = "entities"
        nodes += entity_nodes
        edges += entity_edges

    result = {
        "center": center,
        "nodes": nodes,
        "edges": edges,
        "degraded_from": degraded_from,
        "truncated": False,
        "hint": "",
    }
    while tokens_of(result) > budget and len(nodes) > 1:
        dropped = _node_key(nodes.pop())  # farthest first — nodes are distance-sorted
        edges = [e for e in edges
                 if dropped not in (e.get("source"), e.get("target"), e.get("src"), e.get("dst"))]
        result["edges"] = edges
        result["truncated"] = True
    if result["truncated"]:
        hint = "trimmed to fit budget_tokens — raise it or lower depth."
    elif want_entities and not nodes:
        hint = f"no entities ground '{center}' — brain_read '{center}' for the doc itself."
    else:
        hint = f"brain_read '{center}' for the doc itself."
    result["hint"] = (note or "") + hint
    return result


# -- brain_write -------------------------------------------------------------------


def _slugify(doc: str) -> str:
    base = str(doc).strip().lower().replace("\\", "/").lstrip("/")
    if base.endswith(".md"):
        base = base[:-3]
    parts = []
    for part in base.split("/"):
        if part in ("", ".", ".."):
            continue
        slug = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", part)).strip("-")
        if slug:
            parts.append(slug)
    return "/".join(parts) + ".md" if parts else "untitled.md"


def _resolve_write_path(state: ServeState, doc: str) -> tuple[str | None, str | None]:
    """(bundle-relative path, None) or (None, instruction) — traversal never escapes."""
    raw = str(doc or "").strip()
    if not raw:
        return None, "give doc a bundle-relative kebab-case path like 'kuun-vaiheet.md'"
    if "\\" in raw:
        return None, f"use forward slashes — try '{_slugify(raw)}'"
    rel = raw.lstrip("/")
    if not rel.endswith(".md"):
        rel += ".md"
    rel = posixpath.normpath(rel)
    parts = rel.split("/")
    if rel.startswith("/") or ".." in parts or rel == ".":
        return None, f"'{doc}' escapes the bundle — paths stay inside the bundle root"
    if not (state.root / rel).resolve().is_relative_to(state.root.resolve()):
        return None, f"'{doc}' escapes the bundle — paths stay inside the bundle root"
    if parts[0] in ALWAYS_EXCLUDED_DIRS:
        return None, f"'{parts[0]}/' belongs to the machinery — write concept docs elsewhere"
    bad = [p for p in parts[:-1] if not _KEBAB.match(p)]
    if not _KEBAB.match(parts[-1][:-3]):
        bad.append(parts[-1])
    if bad:
        return None, f"'{doc}' is not kebab-case — try '{_slugify(doc)}'"
    return rel, None


def _run_henxels(state: ServeState, rel: str) -> tuple[str | None, str | None]:
    """(violation instruction, warning) — respecting [validate] henxels = auto|always|never."""
    mode = state.config.validate.henxels
    if mode == "never":
        return None, None
    root = state.root
    has_contract = (root / "henxels.yaml").is_file() or (root / ".henxels").exists()
    if mode != "always" and not has_contract:
        return None, None
    executable = shutil.which("henxels")
    if executable is None:
        if mode == "always":
            return "[validate] henxels = \"always\" but the henxels CLI is not installed", None
        return None, "henxels not installed — write accepted without contract validation"
    try:
        proc = subprocess.run(
            [executable, "check", rel], cwd=root, capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        return "henxels check timed out after 60s — the write was rolled back", None
    if proc.returncode != 0:
        output = (proc.stdout + proc.stderr).strip()
        return output or f"henxels check failed with exit {proc.returncode}", None
    return None, None


def _bump_timestamp(text: str, now: str) -> str:
    """Refresh (or insert) the frontmatter timestamp without reformatting anything else."""
    if text.startswith("---\n"):
        end = text.find("\n---\n", 3)
        if end != -1:
            frontmatter = text[4:end]
            if _TS_LINE.search(frontmatter):
                frontmatter = _TS_LINE.sub(f"timestamp: {now}", frontmatter, count=1)
            else:
                frontmatter = frontmatter + f"\ntimestamp: {now}"
            return "---\n" + frontmatter + "\n---\n" + text[end + 5:]
    return f"---\ntimestamp: {now}\n---\n\n" + text


def conflict_payload(state: ServeState, rel: str, previous: bytes, yours: str, base_sha: str,
                     budget_tokens: int | None) -> dict:
    """The spec/70 conflict shape — nothing was written. `merged`, when the
    resolution ladder produced one, is a PROPOSAL and is never auto-applied."""
    budget = budget_tokens or 2000
    theirs = previous.decode("utf-8", errors="replace")
    current_sha = sha256_hex(previous)
    result = {
        "ok": False,
        "conflict": True,
        "current_sha": current_sha,
        "theirs": theirs,
        "truncated": False,
        "instruction": CONFLICT_INSTRUCTION,
        "hint": f"reconcile against theirs, then brain_write again with base_sha '{current_sha}'.",
    }
    proposal = resolve(find_base(state.root, rel, base_sha), theirs, yours,
                       make_chat(state.config.models.extraction))
    if proposal is not None:
        result["merged"] = proposal
        result["hint"] = (f"merged is a {proposal['strategy']} proposal, NOT applied — review it, "
                          f"then brain_write it with base_sha '{current_sha}'.")
    # Only theirs is budget-shaped; a trimmed merged proposal would be a corrupted write-back.
    if tokens_of(result) > budget:
        overhead = tokens_of({**result, "theirs": ""})
        allowed = max(160, (budget - overhead) * 4)
        if len(theirs) > allowed:
            result["theirs"] = theirs[:allowed].rsplit(" ", 1)[0] + " …"
            result["truncated"] = True
    return result


def guarded_write(state: ServeState, doc: str, content: str, mode: str = "create",
                  base_sha: str | None = None, budget_tokens: int | None = None) -> tuple[str, dict]:
    """The one guarded write path (spec/70): resolve → atomic write → henxels
    referee → rollback-or-recompile → live delta, plus base_sha optimistic
    concurrency and the merge ladder. Returns (status, payload):

      "ok"        → {"path", "seq", "sha", "warning"?}  (sha = new content sha256)
      "badpath"   → {"instruction"}                     (traversal / non-kebab / reserved)
      "conflict"  → the full spec/70 conflict dict (ok/conflict/current_sha/theirs/…/merged?)
      "violation" → {"instruction"}                     (henxels rejected it; rolled back)
      "exists"    → {"instruction"}                     (create mode, target present)

    Both brain_write (MCP, via write_payload) and PUT /api/docs (REST) call this —
    one source of truth for the guarded write, mapped onto each surface's shape.
    """
    if mode not in ("create", "replace", "append_section"):
        mode = "create"  # forgiving enums (spec/70)

    rel, problem = _resolve_write_path(state, doc)
    if problem:
        return "badpath", {"instruction": problem}
    target = state.root / rel
    previous = target.read_bytes() if target.is_file() else None
    text = content if content.endswith("\n") else content + "\n"

    # Optimistic concurrency (spec/70): a mismatched base_sha means the writer's
    # knowledge is stale — the server MUST NOT write. Omitted = last-write-wins.
    if base_sha:
        if previous is None:
            return "conflict", {
                "ok": False, "conflict": True, "current_sha": None, "theirs": "",
                "instruction": "the doc was deleted since you read it — "
                               "re-create it with brain_write, without base_sha",
                "hint": "brain_search can confirm whether it moved instead."}
        if sha256_hex(previous) != base_sha:
            return "conflict", conflict_payload(state, rel, previous, text, base_sha, budget_tokens)

    if mode == "create" and previous is not None:
        return "exists", {
            "instruction": f"'{rel}' already exists — use mode 'replace' or 'append_section'"}

    if mode == "append_section" and previous is not None:
        text = previous.decode("utf-8", errors="replace").rstrip("\n") + "\n\n" + text
    _atomic_write(target, text.encode("utf-8"))

    violation, warning = _run_henxels(state, rel)
    if violation:
        if previous is None:
            target.unlink(missing_ok=True)
        else:
            _atomic_write(target, previous)
        return "violation", {"instruction": violation}

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stamped = _bump_timestamp(target.read_text(encoding="utf-8"), now)
    stamped_bytes = stamped.encode("utf-8")
    _atomic_write(target, stamped_bytes)

    result = recompile_and_broadcast(state)
    payload = {"path": rel, "seq": result.seq, "sha": sha256_hex(stamped_bytes)}
    if warning:
        payload["warning"] = warning
    return "ok", payload


def write_payload(state: ServeState, doc: str, content: str, mode: str = "create",
                  base_sha: str | None = None, budget_tokens: int | None = None,
                  refusal: str | None = None) -> dict:
    """brain_write's MCP result (spec/70) over the shared guarded_write core."""
    if refusal:
        return {"ok": False, "instruction": refusal}
    status, payload = guarded_write(state, doc, content, mode, base_sha, budget_tokens)
    if status == "ok":
        out = {"ok": True, "path": payload["path"], "seq": payload["seq"],
               "hint": f"brain_read '{payload['path']}' to verify — connected UIs already got the delta."}
        if "warning" in payload:
            out["warning"] = payload["warning"]
        return out
    if status == "conflict":
        return payload
    return {"ok": False, "instruction": payload["instruction"]}


# -- the FastMCP wrapper -------------------------------------------------------------


def create_mcp_server(state: ServeState, write_refusal: str | None = None):
    """One FastMCP over a shared ServeState — same instance behind stdio and /mcp."""
    from mcp.server.fastmcp import FastMCP
    from mcp.server.transport_security import TransportSecuritySettings

    server = FastMCP(
        "brainpick",
        instructions=(
            "A compiled knowledge bundle (an agent's brain). Start with brain_overview, "
            "find docs with brain_search, open them with brain_read, walk links with "
            "brain_neighbors, and add knowledge with brain_write."
        ),
        stateless_http=True,
        log_level="WARNING",
        # brainpick guards non-localhost binds with its own bearer token (spec/80);
        # the SDK's Host-header allowlist would only reject legitimate reverse proxies.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    @server.tool()
    def brain_overview(budget_tokens: int | None = None) -> dict:
        """One screen of the whole brain: doc/edge counts, tier status, and every doc
        grouped by folder with its one-line description. Call this first to orient."""
        return overview_payload(state, budget_tokens)

    @server.tool()
    def brain_search(query: str, mode: str = "auto", limit: int = 8,
                     budget_tokens: int | None = None) -> dict:
        """Find docs by keyword. Returns paths, titles, and descriptions — never full
        bodies. Follow up with brain_read on the best hit's path."""
        return search_payload(state, query, mode, limit, budget_tokens)

    @server.tool()
    def brain_read(doc: str, sections: list[str] | None = None,
                   budget_tokens: int | None = None) -> dict:
        """Read one doc: frontmatter, outline, content, and linked neighbors. doc can be
        a path (kuu.md), a bare stem (kuu), or an approximate title. Pass sections=[...]
        with names from the outline to read only those parts."""
        return read_payload(state, doc, sections, budget_tokens)

    @server.tool()
    def brain_neighbors(doc: str, depth: int = 1, layer: str = "links",
                        budget_tokens: int | None = None) -> dict:
        """Walk the link graph around one doc, up to depth 3. Returns nearby docs with
        their distance and the connecting edges."""
        return neighbors_payload(state, doc, depth, layer, budget_tokens)

    @server.tool()
    def brain_write(doc: str, content: str, mode: str = "create",
                    base_sha: str | None = None, budget_tokens: int | None = None) -> dict:
        """Write a markdown doc into the bundle, guarded by its henxels contract. mode is
        create (default, never overwrites), replace, or append_section. Pass base_sha
        (the sha256 of the content you last read) to catch concurrent edits: on a
        mismatch nothing is written and the result returns the current content, its
        current_sha to retry with, and — when resolvable — a merged proposal. On a
        contract violation nothing changes and instruction says exactly what to fix."""
        return write_payload(state, doc, content, mode, base_sha=base_sha,
                             budget_tokens=budget_tokens, refusal=write_refusal)

    @server.resource("brain://index")
    def brain_index() -> str:
        """The generated index block — the bundle's table of contents."""
        path = state.root / "index.md"
        if not path.is_file():
            return ""
        text = path.read_text(encoding="utf-8")
        begin = text.find(BEGIN_PREFIX)
        if begin != -1:
            end = text.find(END_MARKER, begin)
            if end != -1:
                return text[begin:end + len(END_MARKER)]
        return text

    @server.resource("brain://doc/{path}")
    def brain_doc(path: str) -> str:
        """Raw document content by bundle-relative path."""
        record = state.record_for(path)
        if record is None:
            raise ValueError(f"no doc at '{path}'")
        file_path = state.root / path
        return file_path.read_text(encoding="utf-8") if file_path.is_file() else record["text"]

    return server
