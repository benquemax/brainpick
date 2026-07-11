"""e2e: the MCP server over real stdio — spawn `python -m brainpick mcp`, speak the protocol."""
import asyncio
import json
import re
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from brainpick.compile.pipeline import run_compile

from conftest import stage_t3_export

NEW_DOC = (
    "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n"
    "# Uusi kivi\n\nNear [Kuu](kuu.md).\n"
)


async def _call(session, name, arguments):
    result = await session.call_tool(name, arguments)
    assert result.isError is False
    return json.loads(result.content[0].text)


# CI-1 (_plans/2026-07-10-phase1.5-release.md): the prime suspect for
# python-windows' 6-hour job-kill hang — a stdio subprocess pipe that never
# unblocks. asyncio.wait_for cancels the whole scenario (including the
# stdio_client/ClientSession context managers' own awaits) if it doesn't
# finish well inside pytest-timeout's blunter 180s thread-kill backstop, so a
# genuine hang fails FAST with a specific, actionable TimeoutError instead of
# either backstop's coarser signal.
#
# CI-2 (run 29145923212): this DID catch a real hang on python-windows, but
# the write-conflict scenario (2 full brain_write round trips + a mock LLM
# merge negotiation, each against a FRESH `python -m brainpick mcp`
# subprocess) surfaced as BrokenResourceError, not a clean TimeoutError —
# anyio's own task-group cleanup can shadow the original cancellation with a
# new exception raised while tearing down the stdout-reader task, once
# wait_for's timeout actually fires mid-request. That reads as this specific
# scenario genuinely needing more than 60s on a cold/loaded Windows runner
# (subprocess + interpreter cold-start is markedly slower there than the
# POSIX fork-based startup "well under a second locally" was measured
# against), not a NEW bug — raised to 120s, still comfortably under
# pytest-timeout's 180s per-test backstop, matching the same generosity
# global-setup.ts's HEALTH_TIMEOUT_MS already uses for identical reasons.
def _run_scenario(coro):
    asyncio.run(asyncio.wait_for(coro, timeout=120))


async def _scenario(root):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "brainpick", "mcp", "--root", str(root)],
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = {t.name for t in (await session.list_tools()).tools}
            assert tools == {
                "brain_overview", "brain_search", "brain_read", "brain_neighbors",
                "brain_write", "brain_show",
            }

            overview = await _call(session, "brain_overview", {})
            assert overview["counts"]["docs"] == 10
            assert overview["hint"]

            search = await _call(session, "brain_search", {"query": "aurinko"})
            assert "aurinko.md" in {h["path"] for h in search["hits"]}
            assert search["used_modes"] == ["keyword"]

            read_result = await _call(session, "brain_read", {"doc": "kuu"})  # stem resolution
            assert read_result["path"] == "kuu.md"
            assert "tides" in read_result["content"]
            assert {n["path"] for n in read_result["neighbors"]["out"]} == {"maa.md"}

            neighbors = await _call(session, "brain_neighbors", {"doc": "maa.md"})
            assert neighbors["center"] == "maa.md"
            assert {n["path"] for n in neighbors["nodes"]} == {
                "maa.md", "kuu.md", "planeetat.md", "index.md",
            }

            written = await _call(session, "brain_write", {"doc": "uusi-kivi", "content": NEW_DOC})
            assert written["ok"] is True
            assert written["path"] == "uusi-kivi.md"
            assert written["seq"] == 2

            rejected = await _call(session, "brain_write", {"doc": "../ulos.md", "content": "# Ulos\n"})
            assert rejected["ok"] is False
            assert rejected["instruction"]

            shown = await _call(session, "brain_show",
                                {"nodes": ["aurinko.md", "ei-ole"], "annotation": "the star"})
            assert shown["ok"] is True and shown["shown"] == 1
            assert shown["dropped"] == ["ei-ole"]
            assert shown["seq"] == 1  # presentation seq, distinct from the manifest seq

            resources = await session.list_resources()
            assert "brain://index" in {str(r.uri) for r in resources.resources}


def test_mcp_stdio_roundtrip(kotiaurinko):
    run_compile(kotiaurinko)
    _run_scenario(_scenario(kotiaurinko))
    text = (kotiaurinko / "uusi-kivi.md").read_text(encoding="utf-8")
    assert re.search(r"^timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", text, re.MULTILINE)
    manifest = json.loads((kotiaurinko / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["seq"] == 2
    assert not (kotiaurinko.parent / "ulos.md").exists()


async def _semantic_scenario(root):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "brainpick", "mcp", "--root", str(root)],
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            semantic = await _call(session, "brain_search",
                                   {"query": "kuu vuorovesi maa", "mode": "semantic"})
            assert semantic["used_modes"] == ["semantic"]
            assert semantic["degraded_from"] is None
            assert semantic["hits"]

            fused = await _call(session, "brain_search", {"query": "aurinko", "mode": "auto"})
            assert fused["used_modes"] == ["keyword", "semantic"]
            assert fused["degraded_from"] is None
            assert "aurinko.md" in {h["path"] for h in fused["hits"]}


def test_mcp_semantic_search_over_mock_vectors(kotiaurinko):
    (kotiaurinko / "brainpick.toml").write_text('[models.embedding]\nkind = "mock"\n',
                                                encoding="utf-8")
    run_compile(kotiaurinko)
    manifest = json.loads((kotiaurinko / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["tiers"]["t2"] == "fresh"
    _run_scenario(_semantic_scenario(kotiaurinko))


async def _t3_scenario(root):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "brainpick", "mcp", "--root", str(root)],
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            neighbors = await _call(session, "brain_neighbors",
                                    {"doc": "kuu.md", "layer": "entities"})
            assert neighbors["center"] == "kuu.md"
            assert {n["id"] for n in neighbors["nodes"]} == {"kuu", "maa", "vuorovesi", "planeetat"}
            assert neighbors["degraded_from"] is None  # T3 export present — the real layer
            grounding = {doc for node in neighbors["nodes"] for doc in node["source_docs"]}
            assert grounding == {"aurinko.md", "kuu.md", "maa.md", "planeetat.md"}
            assert {"src": "kuu", "dst": "vuorovesi"} in neighbors["edges"]

            orbits = await _call(session, "brain_search",
                                 {"query": "what orbits the star", "mode": "graph", "limit": 4})
            assert {h["path"] for h in orbits["hits"]} == {
                "aurinko.md", "komeetta.md", "maa.md", "planeetat.md",
            }
            assert orbits["used_modes"] == ["graph"]
            assert orbits["degraded_from"] is None
            assert all("entity graph" in h["why"] for h in orbits["hits"])


def test_mcp_t3_entity_queries(kotiaurinko):
    # graph = "off": the spawned server's startup compile must not rederive T3 and
    # overwrite the hand-authored fixture export this test stages (the consumer
    # reads whatever is present — spec/40 kg-query semantics).
    (kotiaurinko / "brainpick.toml").write_text('[modules]\ngraph = "off"\n', encoding="utf-8")
    run_compile(kotiaurinko)
    stage_t3_export(kotiaurinko)  # the reader loads the staged export; no extractor runs
    _run_scenario(_t3_scenario(kotiaurinko))


KUU_REWRITE = (
    "---\ntype: Concept\ntags: [kuu]\ntimestamp: 2026-06-15T08:30:00Z\n---\n\n"
    "# Kuu\n\nThe moon pulls the tides of [Maa](maa.md), rewritten.\n"
)


async def _conflict_scenario(root):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "brainpick", "mcp", "--root", str(root)],
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            stale = await _call(session, "brain_write", {
                "doc": "kuu.md", "content": KUU_REWRITE, "mode": "replace",
                "base_sha": "0" * 64,
            })
            assert stale["ok"] is False
            assert stale["conflict"] is True
            assert stale["current_sha"]
            assert "tides" in stale["theirs"]  # the current content came back
            # the mock extraction model (configured via brainpick.local.toml) proposed a merge
            assert stale["merged"]["strategy"] == "llm"
            assert stale["merged"]["content"] == KUU_REWRITE

            retry = await _call(session, "brain_write", {
                "doc": "kuu.md", "content": KUU_REWRITE, "mode": "replace",
                "base_sha": stale["current_sha"],
            })
            assert retry["ok"] is True
            assert retry["seq"] == 2


def test_mcp_write_conflict_roundtrip(kotiaurinko):
    # the machine-local layer configures the merge model — layering through the real CLI
    (kotiaurinko / "brainpick.local.toml").write_text(
        '[models.extraction]\nkind = "mock"\n', encoding="utf-8",
    )
    run_compile(kotiaurinko)
    _run_scenario(_conflict_scenario(kotiaurinko))
    assert "rewritten" in (kotiaurinko / "kuu.md").read_text(encoding="utf-8")
    manifest = json.loads((kotiaurinko / ".brainpick" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["seq"] == 2
