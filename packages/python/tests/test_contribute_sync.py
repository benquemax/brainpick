"""Read-only mounts on the spec/100 verbs (spec/105): brain_sync fast-forwards
only, brain_push refuses with the redirect, and a remote that denies the push
on a read-write mount teaches the flag.

Real git in a temp repo throughout, as test_sync.py does.
"""
import shutil
import subprocess

import pytest

from brainpick.config import load_config
from brainpick.federation import READ_ONLY
from brainpick.serve.state import ServeState
from brainpick.sync import push_brain, sync_brain

from conftest import FIXTURE_BUNDLES

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")

DOC = "---\ntype: Concept\ntitle: Uusi\ndescription: d\n---\n\n# Uusi\n\n[Kuu](kuu.md)\n"


def git(root, *args, check=True):
    proc = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {proc.stderr}")
    return proc.stdout


def branch_of(root):
    return git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()


def make_pair(tmp_path):
    """(local, other) sharing a bare origin — the implant's upstream and two clones."""
    origin = tmp_path / "origin.git"
    source = tmp_path / "source"
    shutil.copytree(FIXTURE_BUNDLES / "kotiaurinko", source)
    git(tmp_path, "init", "-q", str(source))
    git(source, "config", "user.email", "t@example.com")
    git(source, "config", "user.name", "T")
    git(source, "add", "-A")
    git(source, "commit", "-qm", "seed")
    git(tmp_path, "clone", "-q", "--bare", str(source), str(origin))
    git(source, "remote", "add", "origin", str(origin))
    git(source, "fetch", "-q", "origin")
    git(source, "branch", "--set-upstream-to", f"origin/{branch_of(source)}", branch_of(source))
    other = tmp_path / "other"
    git(tmp_path, "clone", "-q", str(origin), str(other))
    git(other, "config", "user.email", "o@example.com")
    git(other, "config", "user.name", "O")
    return source, other


def state_for(root):
    return ServeState(root, load_config(root))


def commit_upstream(other, name="theirs.md"):
    (other / name).write_text(DOC, encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-qm", "theirs")
    git(other, "push", "-q")


def test_push_on_a_read_only_mount_refuses_with_the_redirect(tmp_path):
    local, _ = make_pair(tmp_path)
    (local / "uusi.md").write_text(DOC, encoding="utf-8")
    result = push_brain(state_for(local), "add uusi", access=READ_ONLY)
    assert result["ok"] is False and result["pushed"] is False
    assert result["access"] == READ_ONLY
    assert "brain_contribute" in result["hint"]
    # nothing was committed: the mirror stays exactly what upstream has
    assert git(local, "status", "--porcelain").strip() == "?? uusi.md"


def test_sync_on_a_read_only_mount_fast_forwards(tmp_path):
    local, other = make_pair(tmp_path)
    commit_upstream(other)
    result = sync_brain(state_for(local), access=READ_ONLY)
    assert result["ok"] is True and result["behind_before"] == 1
    assert (local / "theirs.md").exists()
    assert result["merged"] == [] and result["diverged"] is False


def test_sync_on_a_read_only_mount_never_merges_a_diverged_checkout(tmp_path):
    local, other = make_pair(tmp_path)
    commit_upstream(other)
    (local / "ours.md").write_text(DOC, encoding="utf-8")
    git(local, "add", "-A")
    git(local, "commit", "-qm", "ours")  # the mirror has drifted — someone pushed by hand

    result = sync_brain(state_for(local), access=READ_ONLY)
    assert result["ok"] is False and result["diverged"] is True
    assert result["merged"] == []
    assert "diverged" in result["hint"]
    assert git(local, "log", "--oneline").count("\n") == 2  # ours still on top, no merge commit
    assert not (local / "theirs.md").exists()


def test_push_denied_by_the_remote_teaches_read_only(tmp_path):
    """The one place the condition is DETECTED — from the remote's answer, never guessed."""
    local, _ = make_pair(tmp_path)
    (local / "uusi.md").write_text(DOC, encoding="utf-8")
    # a pre-receive hook that denies everything: the shape of "you have no push rights"
    hook = tmp_path / "origin.git" / "hooks" / "pre-receive"
    hook.write_text("#!/bin/sh\necho 'remote: permission denied' >&2\nexit 1\n", encoding="utf-8")
    hook.chmod(0o755)

    result = push_brain(state_for(local), "add uusi")
    assert result["ok"] is False
    assert "--read-only" in result["hint"] and "brain_contribute" in result["hint"]
