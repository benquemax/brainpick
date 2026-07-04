"""The shared conformance harness — reads spec/conformance/cases.yaml.

Every case class here has a twin in packages/node once M2 lands. Adding a
case to cases.yaml tightens both engines at once. The Python engine claims
every class — nothing here may skip (spec/README).
"""
import json
import shutil

import pytest
import yaml

from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.compile.t1 import build_docs_records, render_report_block
from brainpick.compile.t2 import build_chunks
from brainpick.core.bundle import scan
from brainpick.core.canonical import canonical_jsonl
from brainpick.kg import graph_search, load_kg
from brainpick.query.keyword import search
from brainpick.query.router import run_search
from brainpick.query.vectors import semantic_search

from conftest import SPEC, FIXTURE_BUNDLES, stage_t3_export

MOCK_CONFIG = '[models.embedding]\nkind = "mock"\n'  # the spec/30 conformance embedder

EXPECTED = SPEC / "fixtures" / "expected"
SCENARIOS = SPEC / "fixtures" / "scenarios"
SENTINEL_TIME = "1970-01-01T00:00:00Z"

CASES = yaml.safe_load((SPEC / "conformance" / "cases.yaml").read_text(encoding="utf-8"))["cases"]


def _bundle_copy(tmp_path, name):
    dst = tmp_path / name
    shutil.copytree(FIXTURE_BUNDLES / name, dst)
    return dst


def _normalized_manifest(text: str) -> dict:
    m = json.loads(text)
    m["compiled_at"] = SENTINEL_TIME
    m.pop("generator", None)
    return m


def _case_ids(cls):
    return [c["id"] for c in CASES if c["class"] == cls]


def _cases(cls):
    return [c for c in CASES if c["class"] == cls]


@pytest.mark.parametrize("case", _cases("compile"), ids=_case_ids("compile"))
def test_compile_golden(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    run_compile(root)
    for artifact in case["artifacts"]:
        actual = (root / artifact).read_text(encoding="utf-8")
        expected = (EXPECTED / case["bundle"] / artifact).read_text(encoding="utf-8")
        if artifact.endswith("manifest.json"):
            assert _normalized_manifest(actual) == _normalized_manifest(expected), artifact
        else:
            assert actual == expected, f"{artifact} drifted from golden"


@pytest.mark.parametrize("case", _cases("compile-idempotent"), ids=_case_ids("compile-idempotent"))
def test_compile_idempotent(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    first = run_compile(root)
    snapshot = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
    second = run_compile(root)
    assert first.changed is True and second.changed is False
    assert second.seq == first.seq
    assert {p: p.read_bytes() for p in root.rglob("*") if p.is_file()} == snapshot


@pytest.mark.parametrize("case", _cases("check-fresh"), ids=_case_ids("check-fresh"))
def test_check_fresh(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    run_compile(root)
    assert check_fresh(root).fresh is True
    target = root / case["mutate"]
    target.write_text(target.read_text(encoding="utf-8") + "\nMutation.\n", encoding="utf-8")
    assert check_fresh(root).fresh is False


@pytest.mark.parametrize("case", _cases("chunks"), ids=_case_ids("chunks"))
def test_chunks_golden(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    actual = canonical_jsonl(build_chunks(build_docs_records(scan(root))))
    expected = (EXPECTED / case["bundle"] / case["artifact"]).read_text(encoding="utf-8")
    assert actual == expected, f"{case['artifact']} drifted from golden"


def _mock_query_hits(root, case) -> list[dict]:
    """The full T2 path: compile with the mock embedder, then route the search."""
    (root / "brainpick.toml").write_text(MOCK_CONFIG, encoding="utf-8")
    run_compile(root)
    bp = root / ".brainpick"
    records = [json.loads(line)
               for line in (bp / "t1" / "docs.jsonl").read_text(encoding="utf-8").splitlines()
               if line]
    tiers = json.loads((bp / "manifest.json").read_text(encoding="utf-8"))["tiers"]
    assert tiers["t2"] == "fresh"
    body = run_search(
        records, tiers, case["query"], mode=case["mode"], limit=case["limit"],
        semantic_fn=lambda q, k: semantic_search(bp, records, q, limit=k),
    )
    assert body["degraded_from"] is None  # the mock path must never fall back
    return body["hits"]


@pytest.mark.parametrize("case", _cases("query"), ids=_case_ids("query"))
def test_query(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    if case.get("embedder") == "mock":
        hits = _mock_query_hits(root, case)
    else:
        records = build_docs_records(scan(root))
        hits = search(records, case["query"], limit=case["limit"])
    assert {h["path"] for h in hits} == set(case["expect_paths"])


@pytest.mark.parametrize("case", _cases("report"), ids=_case_ids("report"))
def test_report_golden(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    run_compile(root)
    bp = root / ".brainpick"
    graph = json.loads((bp / "t1" / "graph.json").read_text(encoding="utf-8"))
    tiers = json.loads((bp / "manifest.json").read_text(encoding="utf-8"))["tiers"]
    actual = render_report_block(graph, tiers) + "\n"
    expected = (EXPECTED / case["bundle"] / case["artifact"]).read_text(encoding="utf-8")
    assert actual == expected, f"{case['artifact']} drifted from golden"


@pytest.mark.parametrize("case", _cases("kg-query"), ids=_case_ids("kg-query"))
def test_kg_query(case, tmp_path):
    """T3 consumer over the staged export — the normative reader only, never an
    extractor (spec/40). Asserts the returned document SET."""
    root = _bundle_copy(tmp_path, case["bundle"])
    run_compile(root)
    stage_t3_export(root, case["bundle"])
    bp = root / ".brainpick"
    kg = load_kg(bp)
    assert kg is not None, "the staged export must load — kg-query has nothing to test otherwise"
    records = [json.loads(line)
               for line in (bp / "t1" / "docs.jsonl").read_text(encoding="utf-8").splitlines()
               if line]

    if case["op"] == "search":
        hits = graph_search(kg, records, case["query"], limit=case["limit"])
        got = {h["path"] for h in hits}
    elif case["op"] == "neighbors":
        nodes, _edges = kg.neighbor_entities(case["doc"], case.get("depth", 1))
        got = {doc for node in nodes for doc in node["source_docs"]}
    else:  # pragma: no cover - spec violation
        raise AssertionError(f"unknown kg-query op {case['op']}")
    assert got == set(case["expect_paths"])


@pytest.mark.parametrize("case", _cases("delta"), ids=_case_ids("delta"))
def test_delta_scenario(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    run_compile(root)

    scenario = SCENARIOS / case["scenario"]
    steps = yaml.safe_load((scenario / "steps.yaml").read_text(encoding="utf-8"))["steps"]
    expected_lines = (scenario / "expected-deltas.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(expected_lines) == len(steps)

    for step, expected_line in zip(steps, expected_lines):
        if step["action"] == "write":
            (root / step["path"]).write_text(step["content"], encoding="utf-8")
        elif step["action"] == "delete":
            (root / step["path"]).unlink()
        else:  # pragma: no cover - spec violation
            raise AssertionError(f"unknown action {step['action']}")
        result = run_compile(root)
        assert result.delta == json.loads(expected_line), step["id"]
