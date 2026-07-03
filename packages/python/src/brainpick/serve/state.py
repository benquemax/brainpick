"""Shared serve state: held artifacts, the delta ring buffer, and subscriber fan-out.

Everything the REST routes, the SSE stream, the watcher, and the MCP tools agree
on lives here — one graph, one seq, one broadcast path (spec/60).
"""
from __future__ import annotations

import asyncio
import difflib
import json
import posixpath
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from pathlib import Path

from brainpick.compile.pipeline import CompileResult, run_compile
from brainpick.config import Config
from brainpick.deltas import diff_graphs

RING_SIZE = 512  # spec/60 wants >= 256 replayable deltas

Event = tuple[str, "int | None", str]  # (event name, SSE id, JSON data)


def _dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def jsonable(value):
    """Frontmatter straight out of YAML may hold datetimes; JSON wants strings."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, date):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _stem(path: str) -> str:
    return posixpath.basename(path).rsplit(".", 1)[0]


def suggest_paths(records: list[dict], needle: str, limit: int = 5) -> list[str]:
    """<= `limit` fuzzy path suggestions for a miss (spec/50 docs 404 shape)."""
    needle_l = needle.strip().lower()
    candidates: dict[str, str] = {}
    for record in records:
        for key in (record["path"].lower(), _stem(record["path"]).lower(), str(record["title"]).lower()):
            candidates.setdefault(key, record["path"])
    matches = difflib.get_close_matches(needle_l, list(candidates), n=limit * 3, cutoff=0.4)
    if not matches:  # even for a wild miss, naming the least-far paths beats an empty list
        matches = difflib.get_close_matches(needle_l, list(candidates), n=limit * 3, cutoff=0.1)
    suggestions: list[str] = []
    for match in matches:
        path = candidates[match]
        if path not in suggestions:
            suggestions.append(path)
        if len(suggestions) == limit:
            break
    return suggestions


def resolve_doc(records: list[dict], needle: str) -> tuple[str, object]:
    """The forgiving ladder (spec/70): exact path -> unique stem -> fuzzy title.

    Returns ("ok", record) | ("ambiguous", [records]) | ("miss", [suggested paths]).
    """
    needle = str(needle or "").strip().lstrip("/")
    by_path = {record["path"]: record for record in records}
    if needle in by_path:
        return "ok", by_path[needle]
    if needle + ".md" in by_path:
        return "ok", by_path[needle + ".md"]

    stem_hits = [r for r in records if _stem(r["path"]).lower() == needle.lower()]
    if len(stem_hits) == 1:
        return "ok", stem_hits[0]
    if len(stem_hits) > 1:
        return "ambiguous", stem_hits

    by_title = {str(r["title"]).lower(): r for r in records}
    scored = sorted(
        ((difflib.SequenceMatcher(None, needle.lower(), title).ratio(), title) for title in by_title),
        reverse=True,
    )
    close = [(score, title) for score, title in scored if score >= 0.6]
    if len(close) == 1 or (len(close) > 1 and close[0][0] - close[1][0] >= 0.15):
        return "ok", by_title[close[0][1]]
    if close:
        return "ambiguous", [by_title[title] for _, title in close[:5]]
    return "miss", suggest_paths(records, needle)


def bfs_neighborhood(graph: dict, center: str, depth: int) -> tuple[dict[str, int], list[dict]]:
    """Undirected BFS over the link graph: {id: distance} plus the induced edges."""
    adjacency: dict[str, set[str]] = defaultdict(set)
    for edge in graph["edges"]:
        adjacency[edge["source"]].add(edge["target"])
        adjacency[edge["target"]].add(edge["source"])
    distance = {center: 0}
    frontier = [center]
    for hop in range(1, depth + 1):
        reached: list[str] = []
        for node in frontier:
            for neighbor in adjacency[node]:
                if neighbor not in distance:
                    distance[neighbor] = hop
                    reached.append(neighbor)
        frontier = reached
    edges = [e for e in graph["edges"] if e["source"] in distance and e["target"] in distance]
    return distance, edges


def _changed_paths(old_files: dict, new_files: dict) -> list[str]:
    return sorted(
        path
        for path in old_files.keys() | new_files.keys()
        if old_files.get(path, {}).get("sha256") != new_files.get(path, {}).get("sha256")
    )


class ServeState:
    """Current graph + seq, the delta ring, and the asyncio subscriber registry."""

    def __init__(self, root: str | Path, config: Config):
        self.root = Path(root)
        self.config = config
        self.graph: dict = {"edges": [], "ghosts": [], "islands": [], "nodes": [], "stats": {}, "tags": {}}
        self.manifest: dict = {}
        self.records: list[dict] = []
        self.seq = 0
        self.watching = bool(config.serve.watch)
        self.ring: deque[tuple[int, str]] = deque(maxlen=RING_SIZE)
        self.loop: asyncio.AbstractEventLoop | None = None
        self._subscribers: set[asyncio.Queue] = set()

    # -- loading -----------------------------------------------------------------

    def load(self) -> None:
        """Compile if stale (a serve is a compile), then hold the artifacts."""
        result = run_compile(self.root, config=self.config)
        if result.changed:
            self.apply_compile_result(result)
        else:
            self.reload_artifacts()

    def reload_artifacts(self) -> None:
        bp = self.root / ".brainpick"
        self.manifest = json.loads((bp / "manifest.json").read_text(encoding="utf-8"))
        self.graph = json.loads((bp / "t1" / "graph.json").read_text(encoding="utf-8"))
        lines = (bp / "t1" / "docs.jsonl").read_text(encoding="utf-8").splitlines()
        self.records = [json.loads(line) for line in lines if line]
        self.seq = self.manifest["seq"]

    # -- state transitions -------------------------------------------------------

    def apply_compile_result(self, result: CompileResult) -> None:
        """Adopt an in-process compile: refresh held artifacts, ring + broadcast the delta."""
        if not result.changed:
            return
        self.reload_artifacts()
        if result.delta is not None:
            self._emit_delta(result.delta)
        else:  # the very first compile has no old graph to diff — resync via snapshot
            self._fanout(("graph.snapshot", self.seq, _dumps({"graph": self.graph, "seq": self.seq})))

    def rescan_from_manifest(self) -> None:
        """Adopt an out-of-process compile: diff the held graph against the new artifacts."""
        path = self.root / ".brainpick" / "manifest.json"
        if not path.is_file():
            return
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest["seq"] == self.seq:
            return
        old_graph = self.graph
        old_files = self.manifest.get("files", {})
        self.reload_artifacts()
        delta = diff_graphs(old_graph, self.graph)
        delta["cause"] = {"paths": _changed_paths(old_files, self.manifest.get("files", {})), "tier": "t1"}
        delta["seq"] = self.seq
        self._emit_delta(delta)

    # -- broadcasting ------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def broadcast_status(self, status: str, seq: int) -> None:
        self._fanout(("compile.status", None, _dumps({"seq": seq, "state": status, "tier": "t1"})))

    def _emit_delta(self, delta: dict) -> None:
        data = _dumps(delta)
        self.ring.append((delta["seq"], data))
        self._fanout(("graph.delta", delta["seq"], data))

    def _fanout(self, event: Event) -> None:
        """Deliver on the serving loop; compiles run in worker threads (queues aren't thread-safe)."""
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if self.loop is not None and self.loop is not running:
            self.loop.call_soon_threadsafe(self._deliver, event)
        else:
            self._deliver(event)

    def _deliver(self, event: Event) -> None:
        for queue in list(self._subscribers):
            queue.put_nowait(event)

    # -- replay ------------------------------------------------------------------

    def replay_events(self, last_id: int) -> list[Event] | None:
        """Deltas after `last_id`, or None when only a graph.snapshot can resync (spec/60)."""
        if last_id == self.seq:
            return []
        if last_id > self.seq:
            return None
        expected = last_id + 1
        events: list[Event] = []
        for seq, data in self.ring:
            if seq <= last_id:
                continue
            if seq != expected:
                return None
            events.append(("graph.delta", seq, data))
            expected += 1
        if expected != self.seq + 1:
            return None
        return events

    # -- lookups -----------------------------------------------------------------

    def semantic_fn(self):
        """The vector retriever over this bundle's T2 artifacts (query.vectors),
        shaped for query.router.run_search's semantic_fn hook."""
        from brainpick.query.vectors import semantic_search

        bp = self.root / ".brainpick"

        def run(query: str, limit: int) -> list[dict]:
            return semantic_search(bp, self.records, query, limit=limit)

        return run

    def record_for(self, path: str) -> dict | None:
        return next((r for r in self.records if r["path"] == path), None)

    def neighbors_of(self, path: str) -> dict:
        """{"in": [{path,title}], "out": [...]} from the held link graph (spec/50)."""
        titles = {node["id"]: node["title"] for node in self.graph["nodes"]}
        incoming = sorted({e["source"] for e in self.graph["edges"] if e["target"] == path})
        outgoing = sorted({e["target"] for e in self.graph["edges"] if e["source"] == path})
        return {
            "in": [{"path": p, "title": titles.get(p, p)} for p in incoming],
            "out": [{"path": p, "title": titles.get(p, p)} for p in outgoing],
        }
