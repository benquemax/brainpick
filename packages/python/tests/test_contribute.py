"""brain_contribute / brain_submit (spec/105): proposals in a git worktree — a
second checkout of the same repository — so the served checkout of an implant
the agent does not own is never written.

Real git and a local bare "origin" throughout; the forge rungs use a fake `gh`.
"""
import os
import shutil
import subprocess

import pytest

from brainpick.config import load_config
from brainpick.contribute import (
    contribute,
    drop_proposal,
    list_proposals,
    proposal_dir,
    submit,
)
from brainpick.federation import READ_ONLY, Brain, BrainSet
from brainpick.mcp_server import contribute_payload, submit_payload
from brainpick.serve.state import ServeState
from brainpick.sync import git_status

from conftest import FIXTURE_BUNDLES

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")

DOC = "---\ntype: Concept\ntitle: Uusi\ndescription: d\n---\n\n# Uusi\n\n[Kuu](kuu.md)\n"
FIX = "---\ntype: Concept\ntitle: Kuu\ndescription: fixed\n---\n\n# Kuu\n\nCorrected. [Maa](maa.md)\n"


def git(root, *args, check=True):
    proc = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {proc.stderr}")
    return proc.stdout


def branch_of(root):
    return git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()


@pytest.fixture
def proposals_home(tmp_path, monkeypatch):
    home = tmp_path / "proposals"
    monkeypatch.setenv("BRAINPICK_PROPOSALS", str(home))
    return home


@pytest.fixture
def no_forge(tmp_path, monkeypatch):
    """A PATH with git and nothing else — no gh, no tea."""
    bin_dir = tmp_path / "onlygit"
    bin_dir.mkdir()
    (bin_dir / "git").symlink_to(shutil.which("git"))
    monkeypatch.setenv("PATH", str(bin_dir))
    return bin_dir


def make_mirror(tmp_path, with_id=True):
    """An implant cloned from a bare origin the agent does not own: (mirror, origin, other)."""
    origin = tmp_path / "origin.git"
    seed = tmp_path / "seed"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", seed)
    if with_id:
        (seed / "brainpick.toml").write_text(
            '[bundle]\nid = "abcdefghijklmnopqrstu"\n[brain]\nformat = 3\n', encoding="utf-8")
    git(tmp_path, "init", "-q", str(seed))
    git(seed, "config", "user.email", "t@example.com")
    git(seed, "config", "user.name", "T")
    git(seed, "add", "-A")
    git(seed, "commit", "-qm", "seed")
    git(tmp_path, "clone", "-q", "--bare", str(seed), str(origin))
    mirror = tmp_path / "mirror"
    git(tmp_path, "clone", "-q", str(origin), str(mirror))
    git(mirror, "config", "user.email", "a@example.com")
    git(mirror, "config", "user.name", "Agent")
    other = tmp_path / "other"
    git(tmp_path, "clone", "-q", str(origin), str(other))
    git(other, "config", "user.email", "o@example.com")
    git(other, "config", "user.name", "O")
    return mirror, origin, other


def state_for(root):
    return ServeState(root, load_config(root))


def snapshot(root):
    return (git(root, "rev-parse", "HEAD"), git(root, "status", "--porcelain"))


# -- brain_contribute ------------------------------------------------------------------


def test_contribute_commits_on_a_worktree_branch_and_never_touches_the_mirror(tmp_path, proposals_home):
    mirror, origin, _ = make_mirror(tmp_path)
    before = snapshot(mirror)

    result = contribute(state_for(mirror), "uusi-kivi", DOC, message="add uusi kivi")
    assert result["ok"] is True, result
    p = result["proposal"]
    assert p["name"] == "uusi-kivi" and p["branch"] == "contrib/uusi-kivi"
    assert p["commits"] == 1 and p["stale_base"] is False
    # the doc, plus the index block the compile regenerated (as brain_push stages it) —
    # never the disposable .brainpick/ artifacts
    assert "uusi-kivi.md" in p["files"] and not any(".brainpick" in f for f in p["files"])
    assert p["worktree"] == str(proposal_dir(mirror, "uusi-kivi"))
    assert (proposals_home / "abcdefghijklmnopqrstu" / "uusi-kivi" / "uusi-kivi.md").is_file()
    # the served checkout: same HEAD, same (clean) status, no new file
    assert snapshot(mirror) == before
    assert not (mirror / "uusi-kivi.md").exists()
    # the branch exists in the shared repository, one commit above origin's default
    assert git(mirror, "rev-parse", "--verify", "contrib/uusi-kivi").strip()
    assert git(mirror, "log", "--oneline", "origin/HEAD..contrib/uusi-kivi").count("\n") == 1
    assert "brain_submit" in result["hint"]


def test_contribute_branches_from_the_newest_upstream_not_the_local_checkout(tmp_path, proposals_home):
    mirror, _, other = make_mirror(tmp_path)
    (other / "theirs.md").write_text(DOC, encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")
    # the mirror is now one behind — the proposal must not be

    result = contribute(state_for(mirror), "uusi-kivi", DOC, message="add")
    assert result["ok"] is True
    worktree = proposals_home / "abcdefghijklmnopqrstu" / "uusi-kivi"
    assert (worktree / "theirs.md").is_file()
    assert git(mirror, "status", "--porcelain").strip() == ""  # still a clean mirror, still behind


def test_several_contributions_accumulate_on_one_proposal(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    first = contribute(state_for(mirror), "uusi-kivi", DOC, message="add")
    second = contribute(state_for(mirror), "kuu", FIX, mode="replace", message="fix kuu",
                        proposal="uusi-kivi")
    assert second["ok"] is True and second["proposal"]["commits"] == 2
    assert {"kuu.md", "uusi-kivi.md"} <= set(second["proposal"]["files"])
    assert first["proposal"]["worktree"] == second["proposal"]["worktree"]


def test_contribute_runs_the_guarded_ladder_in_the_worktree(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    exists = contribute(state_for(mirror), "kuu", FIX, message="x")  # create on an existing doc
    assert exists["ok"] is False and "already exists" in exists["instruction"]
    stale = contribute(state_for(mirror), "kuu", FIX, mode="replace", base_sha="0" * 64, message="x")
    assert stale["ok"] is False and stale.get("conflict") is True
    assert git(mirror, "status", "--porcelain").strip() == ""


def test_contribute_reports_a_stale_base_and_never_rebases(tmp_path, proposals_home):
    mirror, _, other = make_mirror(tmp_path)
    contribute(state_for(mirror), "uusi-kivi", DOC, message="add")
    (other / "theirs.md").write_text(DOC, encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")

    result = contribute(state_for(mirror), "toinen", DOC, message="more", proposal="uusi-kivi")
    assert result["ok"] is True and result["proposal"]["stale_base"] is True
    assert "stale" in result["hint"].lower()
    assert result["proposal"]["commits"] == 2  # counted against the proposal's own base


def test_contribute_requires_a_message_and_a_remote(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    assert contribute(state_for(mirror), "uusi-kivi", DOC, message="  ")["ok"] is False
    lone = tmp_path / "lone"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", lone)
    git(tmp_path, "init", "-q", str(lone))
    result = contribute(state_for(lone), "uusi-kivi", DOC, message="add")
    assert result["ok"] is False and "remote" in result["hint"]


def test_first_contact_is_apply_and_brief(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    (mirror / "CONTRIBUTING.md").write_text("# How\n", encoding="utf-8")
    git(mirror, "add", "-A")
    git(mirror, "commit", "-qm", "guide")
    git(mirror, "push", "-q")
    result = contribute(state_for(mirror), "uusi-kivi", DOC, message="add")
    assert result["ok"] is True  # applied…
    assert result["read_first"] == ["CONTRIBUTING.md"]  # …and briefed
    assert "read_first" in result["hint"]


def test_read_first_prefers_the_declared_guide(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    (mirror / "brainpick.toml").write_text(
        '[bundle]\nid = "abcdefghijklmnopqrstu"\n[brain]\nformat = 3\n'
        'contributing = ["kuu.md", "maa.md"]\n', encoding="utf-8")
    git(mirror, "add", "-A")
    git(mirror, "commit", "-qm", "guide")
    git(mirror, "push", "-q")
    result = contribute(state_for(mirror), "uusi-kivi", DOC, message="add")
    assert result["read_first"] == ["kuu.md", "maa.md"]


def test_drop_removes_the_worktree_and_branch(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    contribute(state_for(mirror), "uusi-kivi", DOC, message="add")
    assert drop_proposal(state_for(mirror), "uusi-kivi")["ok"] is True
    assert not proposal_dir(mirror, "uusi-kivi").exists()
    assert git(mirror, "rev-parse", "--verify", "contrib/uusi-kivi", check=False) == ""
    assert drop_proposal(state_for(mirror), "uusi-kivi")["ok"] is False


# -- brain_submit ----------------------------------------------------------------------


def test_submit_at_the_patch_rung_yields_a_patch_that_applies_to_origin(tmp_path, proposals_home, no_forge):
    mirror, origin, other = make_mirror(tmp_path)
    contribute(state_for(mirror), "uusi-kivi", DOC, message="add uusi kivi")

    result = submit(state_for(mirror), "uusi-kivi")
    assert result["ok"] is True and result["rung"] == "patch"
    assert result["title"] == "add uusi kivi"
    assert "## Checks" in result["body"] and "henxels contract" in result["body"]
    assert "add uusi kivi" in result["body"]
    patch = result["patch_path"]
    assert os.path.isfile(patch)
    git(other, "am", patch)  # applies cleanly to origin's default branch
    assert (other / "uusi-kivi.md").is_file()
    # nothing was pushed anywhere
    assert git(origin, "branch", "--list", "contrib/*").strip() == ""


def test_submit_at_the_fork_rung_pushes_to_fork_never_origin(tmp_path, proposals_home, no_forge):
    mirror, origin, _ = make_mirror(tmp_path)
    fork = tmp_path / "fork.git"
    git(tmp_path, "clone", "-q", "--bare", str(origin), str(fork))
    git(mirror, "remote", "add", "fork", str(fork))
    contribute(state_for(mirror), "uusi-kivi", DOC, message="add uusi kivi")

    result = submit(state_for(mirror), "uusi-kivi")
    assert result["ok"] is True and result["rung"] == "fork-remote"
    assert git(fork, "branch", "--list", "contrib/*").strip().endswith("contrib/uusi-kivi")
    assert git(origin, "branch", "--list", "contrib/*").strip() == ""
    assert result["compare_url"]  # a local path origin still yields a compare shape
    # the submission survives a restart: recorded in the proposal's own git config
    listed = {p["name"]: p for p in list_proposals(mirror)}
    assert listed["uusi-kivi"]["submitted"]["rung"] == "fork-remote"


def test_submit_at_the_forge_rung_uses_gh(tmp_path, proposals_home, monkeypatch):
    mirror, origin, _ = make_mirror(tmp_path)
    fork = tmp_path / "fork.git"
    git(tmp_path, "clone", "-q", "--bare", str(origin), str(fork))
    contribute(state_for(mirror), "uusi-kivi", DOC, message="add uusi kivi")
    # From here on origin LOOKS like GitHub (a fetch will fail — tolerated, the
    # remote-tracking refs as last fetched are used) and a fake gh answers.
    git(mirror, "remote", "set-url", "origin", "https://github.com/someone/implant.git")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "gh.log"
    (bin_dir / "gh").write_text(
        "#!/bin/sh\n"
        f"echo \"$@\" >> {log}\n"
        "case \"$1 $2\" in\n"
        "  'auth status') exit 0;;\n"
        f"  'repo fork') git remote add fork {fork}; exit 0;;\n"
        "  'pr create') echo https://github.com/someone/implant/pull/12; exit 0;;\n"
        "esac\nexit 1\n", encoding="utf-8")
    (bin_dir / "gh").chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")

    result = submit(state_for(mirror), "uusi-kivi", title="Fix", body="Because.")
    assert result["ok"] is True and result["rung"] == "forge-cli", result
    assert result["pr_url"] == "https://github.com/someone/implant/pull/12" and result["number"] == 12
    calls = log.read_text(encoding="utf-8")
    assert "pr create" in calls and "--title Fix" in calls
    assert "Because." in result["body"] and "## Checks" in result["body"]
    assert git(fork, "branch", "--list", "contrib/*").strip().endswith("contrib/uusi-kivi")
    assert git(origin, "branch", "--list", "contrib/*").strip() == ""


def test_submit_refuses_an_unknown_proposal(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    result = submit(state_for(mirror), "nothing")
    assert result["ok"] is False and "no proposal" in result["hint"]


# -- lifecycle -------------------------------------------------------------------------


def test_status_lists_proposals_and_detects_merged(tmp_path, proposals_home):
    mirror, origin, other = make_mirror(tmp_path)
    contribute(state_for(mirror), "uusi-kivi", DOC, message="add")
    status = git_status(mirror)
    assert [p["name"] for p in status["proposals"]] == ["uusi-kivi"]
    assert status["proposals"][0]["merged"] is False
    # the maintainer merges it upstream (fast-forward the branch onto origin's default)
    git(other, "fetch", "-q", str(mirror), "contrib/uusi-kivi:contrib/uusi-kivi")
    git(other, "merge", "-q", "--ff-only", "contrib/uusi-kivi")
    git(other, "push", "-q")
    status = git_status(mirror)
    assert status["proposals"][0]["merged"] is True
    assert "merged" in status["hint"] and "drop" in status["hint"]


def test_status_without_proposals_carries_no_key(tmp_path, proposals_home):
    mirror, _, _ = make_mirror(tmp_path)
    assert "proposals" not in git_status(mirror)


# -- the MCP payloads over a federated set --------------------------------------------


def test_payloads_route_by_alias_and_strip_it_from_doc(tmp_path, proposals_home, no_forge):
    mirror, _, _ = make_mirror(tmp_path)
    kirja = tmp_path / "kirja"
    shutil.copytree(FIXTURE_BUNDLES / "kotikirja", kirja)
    brain_set = BrainSet([Brain(alias="aurinko", root=mirror, role="implant", access=READ_ONLY),
                          Brain(alias="kirja", root=kirja, role="cortex")])
    result = contribute_payload(brain_set, "aurinko", "aurinko:uusi-kivi", DOC, message="add")
    assert result["ok"] is True and result["brain"] == "aurinko"
    assert "uusi-kivi.md" in result["proposal"]["files"]
    missing = contribute_payload(brain_set, None, "uusi-kivi", DOC, message="add")
    assert missing["ok"] is False and "brain" in missing["instruction"]
    submitted = submit_payload(brain_set, "aurinko", "uusi-kivi")
    assert submitted["ok"] is True and submitted["brain"] == "aurinko" and submitted["rung"] == "patch"
