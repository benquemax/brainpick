"""Sync (spec/100): brain_status / brain_sync / brain_push — the git verbs.

Every test drives REAL git in a temp repo: a wrong assumption about git's
behaviour is exactly the kind of bug a mocked test would hide.
"""
import shutil
import subprocess

import pytest

from brainpick.config import load_config
from brainpick.serve.state import ServeState
from brainpick.mcp_server import contract_payload
from brainpick.sync import (
    GitUnavailable,
    conflicted_paths,
    git_status,
    merge_stages,
    push_brain,
    run_git,
    sync_brain,
)

from conftest import FIXTURE_BUNDLES

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def git(root, *args, check=True):
    proc = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {proc.stderr}")
    return proc.stdout


def make_repo(tmp_path, name="brain"):
    """A bundle in a git repo, with one commit."""
    root = tmp_path / name
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", root)
    git(root.parent, "init", "-q", str(root))
    git(root, "config", "user.email", "t@example.com")
    git(root, "config", "user.name", "T")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "seed")
    return root


def make_pair(tmp_path):
    """(local, remote-clone) sharing an origin — two machines, one brain."""
    origin = tmp_path / "origin.git"
    source = make_repo(tmp_path, "source")
    git(source.parent, "clone", "-q", "--bare", str(source), str(origin))
    git(source, "remote", "add", "origin", str(origin))
    git(source, "fetch", "-q", "origin")
    git(source, "branch", "--set-upstream-to", f"origin/{branch_of(source)}", branch_of(source))

    other = tmp_path / "other"
    git(tmp_path, "clone", "-q", str(origin), str(other))
    git(other, "config", "user.email", "o@example.com")
    git(other, "config", "user.name", "O")
    return source, other


def branch_of(root):
    return git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()


def state_for(root):
    return ServeState(root, load_config(root))


def run_compile_for(root):
    from brainpick.compile.pipeline import run_compile

    return run_compile(root, config=load_config(root))


# -- run_git ---------------------------------------------------------------------------


def test_run_git_returns_stdout_and_code(tmp_path):
    root = make_repo(tmp_path)
    code, out, _ = run_git(root, "rev-parse", "--abbrev-ref", "HEAD")
    assert code == 0 and out.strip() == branch_of(root)


def test_run_git_never_raises_on_a_failing_command(tmp_path):
    """Git failures are data, not exceptions — every verb reports them."""
    root = make_repo(tmp_path)
    code, _, err = run_git(root, "rev-parse", "--verify", "no-such-ref")
    assert code != 0 and err


def test_run_git_raises_only_when_git_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr("brainpick.sync.shutil.which", lambda _name: None)
    with pytest.raises(GitUnavailable):
        run_git(tmp_path, "status")


# -- git_status ------------------------------------------------------------------------


def test_status_of_a_clean_checkout(tmp_path):
    local, _ = make_pair(tmp_path)
    status = git_status(local)
    assert status["ahead"] == 0 and status["behind"] == 0
    assert status["clean"] is True and status["conflicts"] == []
    assert status["branch"] == branch_of(local)
    assert status["upstream"] is not None


def test_status_counts_ahead_and_behind(tmp_path):
    local, other = make_pair(tmp_path)
    (other / "theirs.md").write_text("---\ntype: Concept\n---\n\n# Theirs\n", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    (local / "ours.md").write_text("---\ntype: Concept\n---\n\n# Ours\n", encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "ours")

    # git_status never fetches (the caller decides whether to touch the network),
    # so `behind` only appears once the remote-tracking ref is up to date.
    assert git_status(local)["behind"] == 0
    run_git(local, "fetch", "-q", "origin")
    status = git_status(local)
    assert status["ahead"] == 1 and status["behind"] == 1
    assert status["clean"] is False


def test_status_reports_a_dirty_tree(tmp_path):
    local, _ = make_pair(tmp_path)
    (local / "kuu.md").write_text("dirty\n", encoding="utf-8")
    (local / "untracked.md").write_text("new\n", encoding="utf-8")
    status = git_status(local)
    assert status["dirty"]["modified"] == 1
    assert status["dirty"]["untracked"] == 1
    assert status["clean"] is False


def test_status_of_a_bundle_with_no_remote(tmp_path):
    """A brain that is not shared is a valid brain — never an error."""
    root = make_repo(tmp_path)
    status = git_status(root)
    assert status["upstream"] is None
    assert status["ahead"] == 0 and status["behind"] == 0
    assert "no upstream" in status["hint"]


def test_status_of_a_plain_directory(tmp_path):
    """Not a repository at all: reported, never raised."""
    plain = tmp_path / "plain"
    plain.mkdir()
    status = git_status(plain)
    assert status["repo"] is False and status["upstream"] is None
    assert "not a git repository" in status["hint"]


# -- merge stages ----------------------------------------------------------------------


def test_conflicted_paths_and_stages_carry_base_ours_theirs(tmp_path):
    """spec/100: git's merge index stages 1/2/3 ARE the ladder's base/ours/theirs.
    This is the load-bearing assumption of doc-wise resolution."""
    local, other = make_pair(tmp_path)
    doc = "kuu.md"
    base = (local / doc).read_text(encoding="utf-8")

    (other / doc).write_text(base + "\nTHEIR line.\n", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    (local / doc).write_text(base + "\nOUR line.\n", encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "ours")

    run_git(local, "fetch", "-q", "origin")
    code, _, _ = run_git(local, "merge", "--no-commit", "--no-ff", "@{u}")
    assert code != 0  # conflict

    assert conflicted_paths(local) == [doc]
    stages = merge_stages(local, doc)
    assert stages["base"] == base
    assert "OUR line." in stages["yours"] and "THEIR line." not in stages["yours"]
    assert "THEIR line." in stages["theirs"] and "OUR line." not in stages["theirs"]


def test_merge_stages_of_a_file_added_on_both_sides_has_no_base(tmp_path):
    """No common ancestor → base is None, and the ladder degrades to the
    two-input merge rather than inventing an ancestor."""
    local, other = make_pair(tmp_path)
    doc = "both.md"
    (other / doc).write_text("---\ntype: Concept\n---\n\n# Theirs\n", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    (local / doc).write_text("---\ntype: Concept\n---\n\n# Ours\n", encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "ours")

    run_git(local, "fetch", "-q", "origin")
    run_git(local, "merge", "--no-commit", "--no-ff", "@{u}")
    stages = merge_stages(local, doc)
    assert stages["base"] is None
    assert "Ours" in stages["yours"] and "Theirs" in stages["theirs"]


# -- brain_sync ------------------------------------------------------------------------


def test_sync_with_nothing_to_do_returns_early(tmp_path):
    local, _ = make_pair(tmp_path)
    result = sync_brain(state_for(local))
    assert result["ok"] is True
    assert result["behind_before"] == 0 and result["merged"] == []
    assert result["committed"] is False


def test_sync_fast_forwards_a_clean_remote_change(tmp_path):
    local, other = make_pair(tmp_path)
    (other / "uusi.md").write_text(
        "---\ntype: Concept\ntitle: Uusi\ndescription: d\n---\n\n# Uusi\n\n[Kuu](kuu.md)\n",
        encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    result = sync_brain(state_for(local))
    assert result["ok"] is True and result["behind_before"] == 1
    assert (local / "uusi.md").exists()
    assert result["unresolved"] == []


def test_sync_keeps_both_edits_when_they_do_not_overlap(tmp_path):
    """Both sides edited the same doc in different places.

    git's own three-way merge already handles this and reports no conflict, so
    the ladder is never consulted — `merged` stays empty precisely BECAUSE
    nothing needed resolving. The guarantee that matters is the outcome: both
    edits survive and no markers reach the doc."""
    local, other = make_pair(tmp_path)
    doc = "kuu.md"
    base = (local / doc).read_text(encoding="utf-8")

    (other / doc).write_text(base + "\nTHEIR paragraph.\n", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    (local / doc).write_text("PREFIX line.\n" + base, encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "ours")

    result = sync_brain(state_for(local))
    assert result["ok"] is True
    assert result["merged"] == [] and result["unresolved"] == []
    text = (local / doc).read_text(encoding="utf-8")
    assert "PREFIX line." in text and "THEIR paragraph." in text
    assert "<<<<<<<" not in text


def test_sync_never_commits_its_resolution(tmp_path):
    """spec/100: a clean mechanical merge is precisely the case where nobody read
    the text. Two correct appends can merge into a page that says two
    contradictory things — the ladder resolves structure, a reader resolves truth."""
    local, other = make_pair(tmp_path)
    doc = "kuu.md"
    base = (local / doc).read_text(encoding="utf-8")
    (other / doc).write_text(base + "\nTHEIRS.\n", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "t")
    git(other, "push", "-q")
    (local / doc).write_text("OURS.\n" + base, encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "o")

    head_before = git(local, "rev-parse", "HEAD").strip()
    result = sync_brain(state_for(local))
    assert result["committed"] is False
    assert git(local, "rev-parse", "HEAD").strip() == head_before


def test_sync_never_writes_conflict_markers(tmp_path):
    """spec/100: markers in frontmatter are invalid YAML — corruption, not a
    conflict. An unresolvable doc is reported and left at the pre-merge state."""
    local, other = make_pair(tmp_path)
    doc = "kuu.md"
    base = (local / doc).read_text(encoding="utf-8")

    (other / doc).write_text("---\ntype: Concept\ntitle: Theirs\n---\n\n# Wholly theirs\n",
                             encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    (local / doc).write_text("---\ntype: Concept\ntitle: Ours\n---\n\n# Wholly ours\n",
                             encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "ours")

    result = sync_brain(state_for(local))  # no chat model configured → no llm rung
    assert [u["path"] for u in result["unresolved"]] == [doc]
    text = (local / doc).read_text(encoding="utf-8")
    assert "<<<<<<<" not in text and ">>>>>>>" not in text
    assert result["unresolved"][0]["theirs"] and result["unresolved"][0]["yours"]
    assert base is not None


def test_sync_reports_when_there_is_no_upstream(tmp_path):
    root = make_repo(tmp_path)
    result = sync_brain(state_for(root))
    assert result["ok"] is False
    assert "no upstream" in result["hint"]


# -- brain_push ------------------------------------------------------------------------


def test_push_publishes_a_bundle_change(tmp_path):
    local, other = make_pair(tmp_path)
    (local / "uusi.md").write_text(
        "---\ntype: Concept\ntitle: Uusi\ndescription: d\n---\n\n# Uusi\n\n[Kuu](kuu.md)\n",
        encoding="utf-8")

    result = push_brain(state_for(local), "add uusi")
    assert result["ok"] is True and result["pushed"] is True
    assert result["commit"]
    git(other, "pull", "-q")
    assert (other / "uusi.md").exists()


def test_push_refuses_when_behind(tmp_path):
    """spec/100: the agent runs brain_sync first — engines never pull implicitly."""
    local, other = make_pair(tmp_path)
    (other / "theirs.md").write_text("---\ntype: Concept\n---\n\n# T\n", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "t")
    git(other, "push", "-q")
    (local / "ours.md").write_text("---\ntype: Concept\n---\n\n# O\n", encoding="utf-8")

    result = push_brain(state_for(local), "ours")
    assert result["ok"] is False and result["pushed"] is False
    assert "behind" in result["hint"] and "brain_sync" in result["hint"]


def test_push_refuses_with_unresolved_conflicts(tmp_path):
    local, other = make_pair(tmp_path)
    doc = "kuu.md"
    base = (local / doc).read_text(encoding="utf-8")
    (other / doc).write_text("---\ntype: Concept\n---\n\n# Theirs\n", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "t")
    git(other, "push", "-q")
    (local / doc).write_text("---\ntype: Concept\n---\n\n# Ours\n", encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "o")
    run_git(local, "fetch", "-q", "origin")
    run_git(local, "merge", "--no-commit", "--no-ff", "@{u}")
    assert base is not None

    result = push_brain(state_for(local), "anything")
    assert result["ok"] is False
    assert "conflict" in result["hint"]


def test_push_refuses_an_empty_message(tmp_path):
    """An engine MUST NOT invent a commit message for shared memory."""
    local, _ = make_pair(tmp_path)
    (local / "uusi.md").write_text("---\ntype: Concept\n---\n\n# U\n", encoding="utf-8")
    result = push_brain(state_for(local), "   ")
    assert result["ok"] is False and "message" in result["hint"]


def test_push_refuses_when_nothing_changed(tmp_path):
    """No empty commits — a push with nothing staged in the bundle is refused.

    push compiles first (so a `--check-fresh` contract cannot reject the very
    commit this tool is making), and a compile that rewrites the generated
    index.md IS a real bundle change. Publish that, and the second push then has
    genuinely nothing to say."""
    local, _ = make_pair(tmp_path)
    first = push_brain(state_for(local), "compile artefacts")
    assert first["ok"] is True

    result = push_brain(state_for(local), "nothing to say")
    assert result["ok"] is False and result["pushed"] is False
    assert "nothing" in result["hint"]


def test_push_refuses_when_the_contract_cannot_be_run(tmp_path, monkeypatch):
    """spec/100: the henxels hook warns and EXITS 0 when it cannot resolve the
    executable, so the commit lands unenforced. An MCP server is the process most
    likely to have that stripped PATH — 'did not run' must never read as 'passed'."""
    local, _ = make_pair(tmp_path)
    (local / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    (local / "uusi.md").write_text("---\ntype: Concept\n---\n\n# U\n", encoding="utf-8")
    monkeypatch.setattr("brainpick.sync.find_henxels", lambda *a, **k: None)

    result = push_brain(state_for(local), "add uusi")
    assert result["ok"] is False and result["pushed"] is False
    assert result["contract"] == "unavailable"
    assert "henxels" in result["instruction"]


def test_push_without_a_contract_is_not_a_skipped_contract(tmp_path, monkeypatch):
    """A bundle with no henxels.yaml has no contract to run — that is not the
    same as a contract that was skipped, and it pushes normally."""
    local, _ = make_pair(tmp_path)
    (local / "uusi.md").write_text("---\ntype: Concept\n---\n\n# U\n", encoding="utf-8")
    monkeypatch.setattr("brainpick.sync.find_henxels", lambda *a, **k: None)

    result = push_brain(state_for(local), "add uusi")
    assert result["ok"] is True and result["pushed"] is True


def test_sync_leaves_no_markers_where_git_would_write_them(tmp_path):
    """Git conflicts on adjacent-line edits and writes `<<<<<<<` into the doc.
    That is corruption in a brain: markers inside frontmatter are invalid YAML,
    which fails the contract and the compile for every later reader.

    brainpick's ladder is deliberately MORE conservative than git's merge
    (merge.three_way: "a heading rename and an edit to the paragraph under it are
    the same neighborhood"), so it declines this one too — and that is the point.
    Declining yields a clean doc plus a report; git yields a broken file. The
    guarantee under test is the absence of markers, not a merge."""
    local, other = make_pair(tmp_path)
    doc = "kuu.md"
    base_lines = [f"line {i}\n" for i in range(1, 9)]
    (local / doc).write_text("".join(base_lines), encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "base body")
    git(local, "push", "-q")
    git(other, "pull", "-q")

    theirs = list(base_lines)
    theirs[7] = "line 8 THEIRS\n"      # last line
    (other / doc).write_text("".join(theirs), encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    ours = list(base_lines)
    ours[6] = "line 7 OURS\n"          # the line immediately before theirs
    (local / doc).write_text("".join(ours), encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "ours")

    # git alone: conflict, and markers written into the working file.
    probe = tmp_path / "probe"
    shutil.copytree(local, probe)
    run_git(probe, "fetch", "-q", "origin")
    code, _, _ = run_git(probe, "merge", "--no-commit", "--no-ff", "@{u}")
    assert code != 0 and conflicted_paths(probe) == [doc]
    assert "<<<<<<<" in (probe / doc).read_text(encoding="utf-8")

    # brainpick: reported, our version intact, not one marker.
    result = sync_brain(state_for(local))
    assert result["ok"] is True
    assert [u["path"] for u in result["unresolved"]] == [doc]
    text = (local / doc).read_text(encoding="utf-8")
    assert "<<<<<<<" not in text and ">>>>>>>" not in text
    assert "line 7 OURS" in text
    # both versions come back in the payload, so nothing is lost — the agent
    # reconciles from the report rather than from a mangled file.
    assert "line 8 THEIRS" in result["unresolved"][0]["theirs"]


# -- brain_contract (spec/100) ---------------------------------------------------------


def test_contract_announces_every_requirement(tmp_path):
    """spec/100: the floor is announced as DATA, so a broken implant can be fixed
    without reading brainpick's source."""
    root = make_repo(tmp_path)
    run_compile_for(root)
    payload = contract_payload(state_for(root))

    ids = [r["id"] for r in payload["requirements"]]
    assert ids == ["bundle-root", "manifest", "artifacts", "fresh",
                   "frontmatter", "brain-format"]
    for req in payload["requirements"]:
        assert set(req) >= {"id", "required", "satisfied", "what", "why"}
    assert payload["satisfied"] is True


def test_contract_reports_a_missing_manifest_with_its_fix(tmp_path):
    root = make_repo(tmp_path)
    payload = contract_payload(state_for(root), compile_first=False)
    manifest = next(r for r in payload["requirements"] if r["id"] == "manifest")
    assert manifest["required"] is True and manifest["satisfied"] is False
    assert "brainpick compile" in manifest["fix"]
    assert payload["satisfied"] is False


def test_contract_reports_a_corrupt_manifest(tmp_path):
    root = make_repo(tmp_path)
    run_compile_for(root)
    (root / ".brainpick" / "manifest.json").write_text("{not json", encoding="utf-8")
    payload = contract_payload(state_for(root), compile_first=False)
    manifest = next(r for r in payload["requirements"] if r["id"] == "manifest")
    assert manifest["satisfied"] is False
    assert "JSON" in manifest["detail"]


def test_contract_never_reports_a_projects_layout_as_a_defect(tmp_path):
    """Folder layout, file naming and memory types are the project's choice — an
    implant is deliberately free to pick its own shape."""
    root = make_repo(tmp_path)
    (root / "WeirdFolder").mkdir()
    (root / "WeirdFolder" / "Weird_Name.md").write_text(
        "---\ntype: Concept\ntitle: W\ndescription: d\n---\n\n# W\n", encoding="utf-8")
    run_compile_for(root)
    payload = contract_payload(state_for(root), compile_first=False)
    assert payload["satisfied"] is True
    assert all("WeirdFolder" not in str(r.get("detail", "")) for r in payload["requirements"])


def test_contract_optional_requirements_never_fail_the_whole(tmp_path):
    """A wiki has no [brain] format; that is legitimate, not unmet-required."""
    root = make_repo(tmp_path)
    run_compile_for(root)
    payload = contract_payload(state_for(root), compile_first=False)
    fmt = next(r for r in payload["requirements"] if r["id"] == "brain-format")
    assert fmt["required"] is False
    assert payload["satisfied"] is True  # satisfied tracks the REQUIRED floor


def test_push_runs_the_whole_contract_not_the_bundle_path(tmp_path, monkeypatch):
    """brain_push verifies the contract the way the pre-commit hook does — every
    henxel, over the whole tree — so it must call `henxels check --all`. Passing
    the bundle directory as a path made henxels test the directory entry itself
    as a file ("_brain — should be .md"), which failed every push of a
    subdirectory bundle governed by a repo-root contract."""
    import subprocess as sp

    local, _ = make_pair(tmp_path)
    (local / "henxels.yaml").write_text("henxels: []\n", encoding="utf-8")
    (local / "uusi.md").write_text("---\ntype: Concept\n---\n\n# U\n", encoding="utf-8")
    monkeypatch.setattr("brainpick.sync.find_henxels", lambda *a, **k: "henxels")
    seen = []
    real_run = sp.run

    def fake_run(argv, **kwargs):  # intercept henxels only; git still runs for real
        if argv[0] != "henxels":
            return real_run(argv, **kwargs)
        seen.append(argv)
        return sp.CompletedProcess(argv, 0, stdout="", stderr="")

    monkeypatch.setattr("brainpick.sync.subprocess.run", fake_run)
    result = push_brain(state_for(local), "add uusi")
    assert result["contract"] == "pass"
    assert seen and seen[0][1:] == ["check", "--all"]
