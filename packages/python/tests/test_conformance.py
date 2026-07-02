"""The shared conformance harness — reads spec/conformance/cases.yaml.

Every case class here has a twin in packages/node once M2 lands. Adding a
case to cases.yaml tightens both engines at once.
"""
import json
import shutil

import pytest
import yaml

from brainpick.compile.pipeline import check_fresh, run_compile
from brainpick.compile.t1 import build_docs_records
from brainpick.core.bundle import scan
from brainpick.query.keyword import search

from conftest import SPEC, FIXTURE_BUNDLES

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


@pytest.mark.parametrize("case", _cases("query"), ids=_case_ids("query"))
def test_query(case, tmp_path):
    root = _bundle_copy(tmp_path, case["bundle"])
    records = build_docs_records(scan(root))
    hits = search(records, case["query"], limit=case["limit"])
    assert {h["path"] for h in hits} == set(case["expect_paths"])


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
