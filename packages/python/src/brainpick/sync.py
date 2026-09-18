"""Sync (spec/100): the git verbs behind brain_status / brain_sync / brain_push.

A brain is shared memory held in Git, but the tools stopped at the checkout: an
agent could consult and write a brain over MCP and then had to shell out to git
to share it. This module is the narrow, audited surface that closes that gap —
three complete operations on one bundle's repository, never a general git tool.

Two rules shape everything here:

* **Git failures are data.** Every helper returns a status rather than raising,
  because a brain that is not a repo, has no remote, or is mid-conflict is a
  legitimate state an agent must be told about — not an exception that kills the
  call.
* **Conflict markers never reach a doc.** Resolution is doc-wise through the
  spec/70 proposal ladder, whose three inputs git's merge index already holds:
  stage 1/2/3 = base/ours/theirs.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from brainpick.detect import detect_henxels, find_henxels

GIT_TIMEOUT = 30  # generous: fetch talks to a network


class GitUnavailable(RuntimeError):
    """No `git` executable — the one condition a caller cannot paper over."""


def run_git(root: str | Path, *args: str, timeout: int = GIT_TIMEOUT) -> tuple[int, str, str]:
    """(returncode, stdout, stderr). A non-zero exit is DATA, not an exception:
    every verb in spec/100 reports git's refusal rather than propagating it."""
    git = shutil.which("git")
    if git is None:
        raise GitUnavailable("git is not installed or not on PATH")
    try:
        proc = subprocess.run(
            [git, "-C", str(root), *args],
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return 1, "", f"git {args[0] if args else ''} timed out after {timeout}s"
    except (OSError, subprocess.SubprocessError) as error:
        return 1, "", str(error)
    return proc.returncode, proc.stdout, proc.stderr


def is_repo(root: str | Path) -> bool:
    code, out, _ = run_git(root, "rev-parse", "--is-inside-work-tree")
    return code == 0 and out.strip() == "true"


def repo_root(root: str | Path) -> Path | None:
    code, out, _ = run_git(root, "rev-parse", "--show-toplevel")
    return Path(out.strip()) if code == 0 and out.strip() else None


def current_branch(root: str | Path) -> str | None:
    code, out, _ = run_git(root, "rev-parse", "--abbrev-ref", "HEAD")
    branch = out.strip()
    return branch if code == 0 and branch and branch != "HEAD" else None


def upstream_of(root: str | Path) -> str | None:
    code, out, _ = run_git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    return out.strip() if code == 0 and out.strip() else None


def ahead_behind(root: str | Path) -> tuple[int, int]:
    """(ahead, behind) against the upstream; (0, 0) when there is none."""
    code, out, _ = run_git(root, "rev-list", "--left-right", "--count", "@{u}...HEAD")
    if code != 0:
        return 0, 0
    parts = out.split()
    if len(parts) != 2:
        return 0, 0
    try:
        behind, ahead = int(parts[0]), int(parts[1])
    except ValueError:
        return 0, 0
    return ahead, behind


def porcelain(root: str | Path, pathspec: str | None = None) -> list[tuple[str, str]]:
    """[(xy, path)] from `status --porcelain` — the two status columns and the path."""
    args = ["status", "--porcelain", "-z"]
    if pathspec is not None:
        args += ["--", pathspec]
    code, out, _ = run_git(root, *args)
    if code != 0:
        return []
    entries: list[tuple[str, str]] = []
    records = [r for r in out.split("\0") if r]
    skip_next = False
    for record in records:
        if skip_next:  # the rename/copy source follows its entry as its own record
            skip_next = False
            continue
        if len(record) < 4:
            continue
        xy, path = record[:2], record[3:]
        if xy[0] in ("R", "C"):
            skip_next = True
        entries.append((xy, path))
    return entries


def conflicted_paths(root: str | Path) -> list[str]:
    """Paths left unmerged, sorted. `diff --name-only --diff-filter=U` is exact —
    porcelain's UU/AA/DD codes miss some of the rarer unmerged combinations."""
    code, out, _ = run_git(root, "diff", "--name-only", "--diff-filter=U")
    if code != 0:
        return []
    return sorted(line for line in out.splitlines() if line)


def merge_stages(root: str | Path, rel: str) -> dict[str, str | None]:
    """{"base", "yours", "theirs"} for a conflicted path, read from the merge index.

    spec/100's load-bearing mapping: git's index stages are exactly the ladder's
    three inputs — :1: the merge base, :2: ours, :3: theirs. A stage that does not
    exist (a file added on both sides has no ancestor) is None, and the ladder
    degrades to the two-input merge rather than inventing a base."""
    pathspec = rel.replace("\\", "/")
    out: dict[str, str | None] = {}
    for key, stage in (("base", 1), ("yours", 2), ("theirs", 3)):
        code, text, _ = run_git(root, "show", f":{stage}:{pathspec}")
        out[key] = text if code == 0 else None
    return out


def git_status(root: str | Path) -> dict:
    """spec/100 brain_status: the checkout's relationship to its remote.

    Never fetches — the caller decides whether to touch the network, because a
    fetch is the one part of status that can be slow or fail."""
    root = Path(root)
    if not is_repo(root):
        return {
            "repo": False, "branch": None, "upstream": None, "ahead": 0, "behind": 0,
            "dirty": {"modified": 0, "untracked": 0, "staged": 0},
            "conflicts": [], "clean": True,
            "hint": "not a git repository — this brain is local only; nothing to sync or push.",
        }

    branch = current_branch(root)
    upstream = upstream_of(root)
    ahead, behind = ahead_behind(root) if upstream else (0, 0)
    conflicts = conflicted_paths(root)

    modified = untracked = staged = 0
    for xy, _path in porcelain(root):
        if xy == "??":
            untracked += 1
            continue
        if xy[0] not in (" ", "?"):
            staged += 1
        if xy[1] not in (" ", "?"):
            modified += 1
    dirty = {"modified": modified, "untracked": untracked, "staged": staged}

    clean = ahead == 0 and behind == 0 and not conflicts and not any(dirty.values())
    return {
        "repo": True, "branch": branch, "upstream": upstream,
        "ahead": ahead, "behind": behind, "dirty": dirty,
        "conflicts": conflicts, "clean": clean,
        "hint": _status_hint(upstream, ahead, behind, dirty, conflicts, clean),
    }


def _status_hint(upstream, ahead, behind, dirty, conflicts, clean) -> str:
    if conflicts:
        n = len(conflicts)
        return (f"{n} path{'s' if n != 1 else ''} still conflicted — resolve them "
                f"(brain_sync proposes merges), then brain_push.")
    if upstream is None:
        return ("no upstream — this checkout tracks no remote branch; "
                "nothing to pull, and brain_push has nowhere to send.")
    if clean:
        return "in sync with the remote, nothing to do."
    parts = []
    if behind:
        parts.append(f"{behind} commit{'s' if behind != 1 else ''} behind — run brain_sync")
    if ahead:
        parts.append(f"{ahead} commit{'s' if ahead != 1 else ''} ahead — run brain_push")
    if any(dirty.values()):
        parts.append(f"uncommitted changes ({dirty['modified']} modified, "
                     f"{dirty['staged']} staged, {dirty['untracked']} untracked)")
    return "; ".join(parts) + "."


# -- brain_sync ------------------------------------------------------------------------


def _budget_shape(text: str | None, limit: int = 4000) -> str:
    """Trim a doc for a payload. Only the REPORTED copies are shaped — a trimmed
    merge proposal written back would be a corrupted doc."""
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + "\n… (trimmed)"


def sync_brain(state, budget_tokens: int | None = None) -> dict:
    """spec/100 brain_sync: bring the remote's work in, resolve what collides
    doc-wise, recompile — and commit NOTHING."""
    from brainpick.compile.pipeline import run_compile
    from brainpick.llm import make_chat
    from brainpick.merge import resolve

    root = Path(state.root)
    repo = repo_root(root) or root
    result: dict = {"ok": False, "brain": root.name, "behind_before": 0,
                    "merged": [], "unresolved": [], "committed": False, "hint": ""}

    if not is_repo(root):
        result["hint"] = "not a git repository — nothing to sync."
        return result
    if upstream_of(repo) is None:
        result["hint"] = ("no upstream — this checkout tracks no remote branch; "
                          "set one with `git branch --set-upstream-to`.")
        return result

    code, _, err = run_git(repo, "fetch", "--quiet")
    if code != 0:
        result["hint"] = f"fetch failed: {err.strip() or 'unknown error'}"
        return result

    _ahead, behind = ahead_behind(repo)
    result["behind_before"] = behind
    if behind == 0:
        result["ok"] = True
        result["hint"] = "already up to date with the remote."
        return result

    # A dirty tree cannot be merged into; stash for the duration and restore after.
    stashed = False
    if any(xy != "??" for xy, _ in porcelain(repo)):
        code, out, _ = run_git(repo, "stash", "push", "-m", "brainpick-sync")
        stashed = code == 0 and "No local changes" not in out

    code, _, merge_err = run_git(repo, "merge", "--no-commit", "--no-ff", "@{u}")
    conflicts = conflicted_paths(repo)
    if code != 0 and not conflicts:
        run_git(repo, "merge", "--abort")
        if stashed:
            run_git(repo, "stash", "pop")
        result["hint"] = f"merge failed: {merge_err.strip() or 'unknown error'}"
        return result

    chat = make_chat(state.config.models.extraction)
    for rel in conflicts:
        stages = merge_stages(repo, rel)
        proposal = resolve(stages["base"], stages["theirs"] or "", stages["yours"] or "", chat)
        if proposal is None:
            # spec/100: never leave markers in a doc. Restore ours and report.
            run_git(repo, "checkout", "--ours", "--", rel)
            run_git(repo, "add", "--", rel)
            result["unresolved"].append({
                "path": rel,
                "theirs": _budget_shape(stages["theirs"]),
                "yours": _budget_shape(stages["yours"]),
                "reason": ("edits overlap and no [models.extraction] chat model is "
                           "configured — reconcile by hand, then brain_write"),
            })
            continue
        (repo / rel).write_text(proposal["content"], encoding="utf-8")
        run_git(repo, "add", "--", rel)
        result["merged"].append({"path": rel, "strategy": proposal["strategy"]})

    if stashed:
        run_git(repo, "stash", "pop")

    try:
        run_compile(root, config=state.config)
    except Exception:  # noqa: BLE001 — a compile problem is reported by the next read
        pass
    state.load()

    result["ok"] = True
    result["hint"] = _sync_hint(result)
    return result


def _sync_hint(result: dict) -> str:
    merged, unresolved = result["merged"], result["unresolved"]
    parts = [f"pulled {result['behind_before']} commit"
             f"{'s' if result['behind_before'] != 1 else ''}"]
    if merged:
        parts.append(f"{len(merged)} doc{'s' if len(merged) != 1 else ''} merged "
                     f"({', '.join(m['path'] for m in merged)}) — REVIEW before pushing, "
                     f"nothing was committed")
    if unresolved:
        parts.append(f"{len(unresolved)} unresolved ({', '.join(u['path'] for u in unresolved)}) "
                     f"— reconcile with brain_write, then brain_push")
    if not merged and not unresolved:
        parts.append("no conflicts")
    return "; ".join(parts) + "."


# -- brain_push ------------------------------------------------------------------------


def run_contract(root: str | Path, config=None) -> tuple[str, str | None]:
    """spec/100's contract gate → (outcome, detail).

    outcome ∈ pass | fail | unavailable | none. The distinction that matters is
    `unavailable` vs `pass`: the henxels-managed hook prints a warning and EXITS 0
    when it cannot resolve the executable, so a commit lands with the contract
    unenforced — and an MCP server is the process most likely to carry exactly
    that stripped PATH. A push whose contract was skipped is not a verified push.
    """
    root = Path(root)
    if config is not None and getattr(config.validate, "henxels", "auto") == "never":
        return "none", None
    contract = detect_henxels(root)
    if contract is None and not (root / ".henxels").exists():
        return "none", None  # no contract to run — NOT a contract that was skipped
    executable = find_henxels()
    if executable is None:
        return "unavailable", (
            "the henxels contract governs this bundle but the henxels CLI could not be "
            "found (PATH or the per-user launcher dirs). Install it — "
            "`uv tool install henxels` — or commit and push from a shell where it is "
            "available. Refusing to publish an unverified commit.")
    cwd = contract.parent if contract is not None else root
    target = os.path.relpath(root, cwd) or "."
    try:
        proc = subprocess.run([executable, "check", target], cwd=cwd,
                              capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return "fail", "henxels check timed out after 120s — nothing was committed"
    except OSError as error:
        return "unavailable", f"could not run henxels: {error}"
    if proc.returncode != 0:
        return "fail", (proc.stdout + proc.stderr).strip() or "henxels check failed"
    return "pass", None


def push_brain(state, message: str) -> dict:
    """spec/100 brain_push: compile, run the contract, stage the bundle, commit, push.
    Hooks always run — no engine may pass --no-verify."""
    from brainpick.compile.pipeline import run_compile

    root = Path(state.root)
    repo = repo_root(root) or root
    result: dict = {"ok": False, "brain": root.name, "commit": None,
                    "pushed": False, "hint": ""}

    if not is_repo(root):
        result["hint"] = "not a git repository — nothing to push."
        return result
    if not str(message).strip():
        result["hint"] = ("a commit message is required — an engine never invents one "
                          "for shared memory.")
        return result

    # Fetch first: `behind` is meaningless against a stale remote-tracking ref, and
    # refusing to push when behind is the check that keeps this tool from ever
    # pulling on the agent's behalf. A fetch failure is not fatal — an offline
    # machine may still legitimately commit and fail at the push.
    run_git(repo, "fetch", "--quiet")
    status = git_status(repo)
    if status["conflicts"]:
        result["hint"] = (f"{len(status['conflicts'])} path(s) still in conflict "
                          f"({', '.join(status['conflicts'])}) — unresolved work is never "
                          f"published; resolve, then push.")
        return result
    if status["upstream"] is None:
        result["hint"] = "no upstream — this checkout tracks no remote branch."
        return result
    if status["behind"] > 0:
        result["hint"] = (f"{status['behind']} commit(s) behind the remote — run brain_sync "
                          f"first; this tool never pulls on your behalf.")
        return result

    # Compile BEFORE committing: a contract running --check-fresh on pre-commit would
    # otherwise reject the very commit this tool is making.
    try:
        run_compile(root, config=state.config)
    except Exception:  # noqa: BLE001
        pass

    outcome, detail = run_contract(root, state.config)
    if outcome == "unavailable":
        result.update({"contract": "unavailable", "instruction": detail,
                       "hint": "the contract could not be run — refusing to push."})
        return result
    if outcome == "fail":
        result.update({"contract": "fail", "instruction": detail,
                       "hint": "the henxels contract rejected this bundle — fix it, then push."})
        return result
    result["contract"] = outcome

    # Stage the BUNDLE, never the whole repo: a brain repo may hold files that are
    # not the brain, and a tool that publishes on an agent's word must not sweep up
    # work nobody reviewed.
    pathspec = os.path.relpath(root, repo) or "."
    code, _, err = run_git(repo, "add", "--", pathspec)
    if code != 0:
        result["hint"] = f"git add failed: {err.strip()}"
        return result

    code, staged, _ = run_git(repo, "diff", "--cached", "--name-only", "--", pathspec)
    if not staged.strip():
        ahead = status["ahead"]
        if ahead > 0:  # nothing new to commit, but local commits still need sending
            code, _, err = run_git(repo, "push")
            if code != 0:
                result["hint"] = f"push failed: {err.strip()}"
                return result
            result.update({"ok": True, "pushed": True,
                           "commit": run_git(repo, "rev-parse", "HEAD")[1].strip(),
                           "hint": f"pushed {ahead} existing commit(s); nothing new to commit."})
            return result
        result["hint"] = "nothing to push — no changes in the bundle and nothing ahead."
        return result

    code, out, err = run_git(repo, "commit", "-m", str(message).strip())
    if code != 0:
        output = (out + err).strip()
        result.update({"contract": "fail", "instruction": output,
                       "hint": "the commit was rejected (hooks run — never bypassed)."})
        return result
    commit = run_git(repo, "rev-parse", "HEAD")[1].strip()

    code, out, err = run_git(repo, "push")
    if code != 0:
        result.update({"commit": commit,
                       "hint": f"committed {commit[:8]} but the push failed: "
                               f"{(err or out).strip()}"})
        return result
    result.update({"ok": True, "commit": commit, "pushed": True,
                   "hint": f"committed {commit[:8]} and pushed to {status['upstream']}."})
    return result
