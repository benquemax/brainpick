"""The merge resolution ladder (spec/70 brain_write): mechanical three-way when
edits do not overlap, the [models.extraction] model when they do, None (manual)
when neither is available. Overlap detection is conservative: in doubt, None."""
import subprocess

import pytest

from brainpick.core.canonical import sha256_hex
from brainpick.llm import ChatUnavailable, MockChat
from brainpick.merge import (
    MERGE_SYSTEM,
    MERGE_SYSTEM_TWO,
    find_base,
    git_base,
    llm_merge,
    llm_merge_two,
    resolve,
    three_way,
)

BASE = """---
type: Concept
title: Kuu
description: The moon.
timestamp: 2026-06-15T08:30:00Z
---

# Kuu

The moon pulls the tides.

## Vaiheet

New moon, then full moon.

## Loppu

The end.
"""

THEIRS = BASE.replace("The moon pulls the tides.", "The moon pulls the tides of every sea.")
YOURS = BASE.replace("New moon, then full moon.", "New moon, waxing crescent, then full moon.")


# -- three_way -----------------------------------------------------------------------


def test_three_way_merges_non_overlapping_edits():
    merged = three_way(BASE, THEIRS, YOURS)
    assert merged is not None
    assert "tides of every sea" in merged        # their edit survives
    assert "waxing crescent" in merged           # your edit survives
    assert "The end." in merged                  # untouched regions intact
    assert merged.startswith("---\n")            # frontmatter intact


def test_three_way_merges_an_appended_section():
    appended = BASE + "\n## Uusi\n\nAppended at the end.\n"
    merged = three_way(BASE, appended, YOURS)
    assert merged is not None
    assert "Appended at the end." in merged
    assert "waxing crescent" in merged


def test_three_way_trivial_cases():
    assert three_way(BASE, BASE, YOURS) == YOURS       # they did nothing — yours wins
    assert three_way(BASE, THEIRS, BASE) == THEIRS     # you did nothing — theirs wins
    assert three_way(BASE, THEIRS, THEIRS) == THEIRS   # identical edits agree


def test_three_way_overlapping_edits_return_none():
    theirs = BASE.replace("The moon pulls the tides.", "Their version of the line.")
    yours = BASE.replace("The moon pulls the tides.", "Your version of the line.")
    assert three_way(BASE, theirs, yours) is None


def test_three_way_adjacent_edits_are_conservatively_none():
    # Edits with no stable line between them collapse into one region → conflict.
    theirs = BASE.replace("## Vaiheet", "## Vaiheet ja muodot")
    yours = BASE.replace(
        "## Vaiheet\n\nNew moon, then full moon.",
        "## Vaiheet\n\nNew moon, then full moon, then new again.",
    )
    assert three_way(BASE, theirs, yours) is None


def test_three_way_handles_missing_trailing_newline():
    base = "one\ntwo\nthree"
    merged = three_way(base, "one!\ntwo\nthree", "one\ntwo\nthree!")
    assert merged == "one!\ntwo\nthree!"


# -- llm_merge -----------------------------------------------------------------------


def good_merge() -> str:
    return THEIRS.replace("New moon, then full moon.", "New moon, waxing crescent, then full moon.")


def test_llm_merge_returns_a_sane_reply_and_prompts_with_all_three():
    chat = MockChat(reply=good_merge())
    merged = llm_merge(BASE, THEIRS, YOURS, chat)
    assert merged == good_merge()
    ((system, user),) = chat.calls
    assert system == MERGE_SYSTEM
    assert "BASE" in user and "THEIRS" in user and "YOURS" in user
    assert "tides of every sea" in user and "waxing crescent" in user


def test_llm_merge_unwraps_a_code_fence():
    chat = MockChat(reply="```markdown\n" + good_merge() + "```\n")
    assert llm_merge(BASE, THEIRS, YOURS, chat) == good_merge()


def test_llm_merge_rejects_conflict_markers():
    reply = good_merge() + "<<<<<<< theirs\nx\n=======\ny\n>>>>>>> yours\n"
    assert llm_merge(BASE, THEIRS, YOURS, MockChat(reply=reply)) is None


def test_llm_merge_rejects_lost_or_broken_frontmatter():
    assert llm_merge(BASE, THEIRS, YOURS, MockChat(reply="# Kuu\n\nNo frontmatter.\n")) is None
    broken = "---\n: not yaml [\n---\n\n# Kuu\n"
    assert llm_merge(BASE, THEIRS, YOURS, MockChat(reply=broken)) is None


def test_llm_merge_rejects_empty_and_survives_backend_failure():
    assert llm_merge(BASE, THEIRS, YOURS, MockChat(reply="   \n")) is None

    class Down:
        def complete(self, system, user):
            raise ChatUnavailable("backend down")

    assert llm_merge(BASE, THEIRS, YOURS, Down()) is None


def test_llm_merge_two_acknowledges_the_missing_ancestor():
    chat = MockChat(reply=good_merge())
    merged = llm_merge_two(THEIRS, YOURS, chat)
    assert merged == good_merge()
    ((system, user),) = chat.calls
    assert system == MERGE_SYSTEM_TWO
    assert "ancestor" in system.lower()
    assert "BASE" not in user  # two inputs only — the prompt stays honest


# -- resolve: the ladder ---------------------------------------------------------------


def test_resolve_prefers_mechanical_three_way():
    chat = MockChat(reply="never used")
    proposal = resolve(BASE, THEIRS, YOURS, chat)
    assert proposal is not None
    assert proposal["strategy"] == "three-way"
    assert "waxing crescent" in proposal["content"]
    assert chat.calls == []  # the model is never bothered when mechanics suffice


def test_resolve_falls_back_to_llm_on_overlap():
    theirs = BASE.replace("The moon pulls the tides.", "Their line.")
    yours = BASE.replace("The moon pulls the tides.", "Your line.")
    proposal = resolve(BASE, theirs, yours, MockChat(reply=good_merge()))
    assert proposal == {"content": good_merge(), "strategy": "llm"}


def test_resolve_overlap_without_a_model_is_manual():
    theirs = BASE.replace("The moon pulls the tides.", "Their line.")
    yours = BASE.replace("The moon pulls the tides.", "Your line.")
    assert resolve(BASE, theirs, yours, None) is None


def test_resolve_without_base_uses_the_two_input_prompt():
    chat = MockChat(reply=good_merge())
    proposal = resolve(None, THEIRS, YOURS, chat)
    assert proposal == {"content": good_merge(), "strategy": "llm"}
    ((system, _user),) = chat.calls
    assert system == MERGE_SYSTEM_TWO  # no base → never pretend there was one


def test_resolve_without_base_or_model_is_manual():
    assert resolve(None, THEIRS, YOURS, None) is None


def test_resolve_insane_model_output_is_manual():
    theirs = BASE.replace("The moon pulls the tides.", "Their line.")
    yours = BASE.replace("The moon pulls the tides.", "Your line.")
    assert resolve(BASE, theirs, yours, MockChat(reply="<<<<<<< nope\n")) is None


# -- the base: git HEAD, hash-verified -------------------------------------------------


def git(*args: str, cwd) -> None:
    subprocess.run(
        ["git", "-c", "user.name=test", "-c", "user.email=test@test", "-c", "commit.gpgsign=false",
         *args],
        cwd=cwd, check=True, capture_output=True,
    )


@pytest.fixture
def committed_bundle(tmp_path):
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "kuu.md").write_text(BASE, encoding="utf-8")
    git("init", "-q", cwd=bundle)
    git("add", "-A", cwd=bundle)
    git("commit", "-qm", "base", cwd=bundle)
    (bundle / "kuu.md").write_text(THEIRS, encoding="utf-8")  # the tree moved on
    return bundle


def test_git_base_returns_the_committed_bytes(committed_bundle):
    assert git_base(committed_bundle, "kuu.md") == BASE.encode("utf-8")
    assert git_base(committed_bundle, "olematon.md") is None  # never committed


def test_git_base_outside_any_repo_is_none(tmp_path):
    lone = tmp_path / "lone"
    lone.mkdir()
    (lone / "kuu.md").write_text(BASE, encoding="utf-8")
    assert git_base(lone, "kuu.md") is None


def test_git_base_scopes_to_a_bundle_subdir(tmp_path):
    repo = tmp_path / "repo"
    bundle = repo / "docs"
    bundle.mkdir(parents=True)
    (bundle / "kuu.md").write_text(BASE, encoding="utf-8")
    git("init", "-q", cwd=repo)
    git("add", "-A", cwd=repo)
    git("commit", "-qm", "base", cwd=repo)
    assert git_base(bundle, "kuu.md") == BASE.encode("utf-8")  # HEAD:./kuu.md, not repo-root


def test_find_base_only_trusts_a_hash_verified_head(committed_bundle):
    base_sha = sha256_hex(BASE.encode("utf-8"))
    assert find_base(committed_bundle, "kuu.md", base_sha) == BASE
    # The writer read something HEAD is not — a guessed base would merge wrongly.
    assert find_base(committed_bundle, "kuu.md", sha256_hex(b"elsewhere")) is None
    assert find_base(committed_bundle, "olematon.md", base_sha) is None
