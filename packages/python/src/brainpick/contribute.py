"""Contribute (spec/105): proposing changes to a brain the agent does not own.

A PROPOSAL is a branch (`contrib/<name>`) holding the commits the agent wants
upstream, checked out in a git WORKTREE — a second checkout of the same
repository in another folder, sharing its object store and hooks — so the
served checkout stays exactly what upstream has: clean, fast-forwardable, a
mirror. brain_contribute writes there through the same guarded ladder as
brain_write and commits; brain_submit sends the branch to the agent's OWN copy
(its fork) or, failing that, produces a patch. Nothing on this path ever writes
the original repository (origin).

Two vocabularies on purpose throughout the hints: the git term and a plain
twin, because the payloads are read by agents on behalf of people who do not
know what a fork remote is.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from brainpick.sync import (
    READ_ONLY,
    _push_denied,
    is_repo,
    repo_root,
    run_contract,
    run_git,
    upstream_of,
)

BRANCH_PREFIX = "contrib/"
_SLUG = re.compile(r"[^a-z0-9]+")
_PR_NUMBER = re.compile(r"/pull/(\d+)|/pulls/(\d+)")


# -- where proposals live --------------------------------------------------------------


def proposals_home(env: dict | None = None) -> Path:
    env = os.environ if env is None else env
    override = env.get("BRAINPICK_PROPOSALS")
    if override:
        return Path(override).expanduser()
    xdg = env.get("XDG_DATA_HOME") or str(Path(env.get("HOME", "~")).expanduser() / ".local" / "share")
    return Path(xdg) / "brainpick" / "proposals"


def slugify(name: str) -> str:
    return _SLUG.sub("-", str(name).lower()).strip("-") or "proposal"


def _brain_key(root: Path) -> str:
    """The folder a brain's proposals share: its [bundle] id, else the repo name."""
    from brainpick.config import load_config

    repo = repo_root(root) or root
    for candidate in (root, repo):
        try:
            bundle_id = load_config(candidate).bundle.id
        except Exception:  # noqa: BLE001
            bundle_id = ""
        if bundle_id:
            return bundle_id
    return slugify(repo.name)


def proposal_dir(root: str | Path, name: str, env: dict | None = None) -> Path:
    root = Path(root).resolve()
    return proposals_home(env) / _brain_key(root) / slugify(name)


def branch_name(name: str) -> str:
    return BRANCH_PREFIX + slugify(name)


# -- git plumbing ----------------------------------------------------------------------


def default_branch(repo: Path) -> str | None:
    """origin's default branch — the newest upstream version a proposal branches from."""
    code, out, _ = run_git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if code == 0 and out.strip():
        return out.strip().split("/", 1)[1]
    upstream = upstream_of(repo)
    if upstream and "/" in upstream:
        return upstream.split("/", 1)[1]
    code, out, _ = run_git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    return out.strip() if code == 0 and out.strip() else None


def _has_remote(repo: Path, name: str = "origin") -> bool:
    code, out, _ = run_git(repo, "remote")
    return code == 0 and name in out.split()


def _rev(repo: Path, ref: str) -> str | None:
    code, out, _ = run_git(repo, "rev-parse", "--verify", "--quiet", ref)
    return out.strip() if code == 0 and out.strip() else None


def _worktree_paths(repo: Path) -> dict[str, str]:
    """branch → worktree path for every worktree of the repository."""
    code, out, _ = run_git(repo, "worktree", "list", "--porcelain")
    result: dict[str, str] = {}
    if code != 0:
        return result
    path = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = line[len("worktree "):]
        elif line.startswith("branch ") and path:
            result[line[len("branch "):].replace("refs/heads/", "")] = path
    return result


def _proposal_base(worktree: Path) -> str | None:
    code, out, _ = run_git(worktree, "config", "--get", "brainpick.proposal.base")
    return out.strip() if code == 0 and out.strip() else None


def _record(worktree: Path, key: str, value: str) -> None:
    # Per-worktree config keeps proposal state out of the served checkout and
    # survives a server restart (spec/105 *Lifecycle*).
    run_git(worktree, "config", "extensions.worktreeConfig", "true")
    run_git(worktree, "config", "--worktree", key, value)


def _read(worktree: Path, key: str) -> str | None:
    code, out, _ = run_git(worktree, "config", "--worktree", "--get", key)
    if code != 0 or not out.strip():
        code, out, _ = run_git(worktree, "config", "--get", key)
    return out.strip() if code == 0 and out.strip() else None


def _bundle_rel(root: Path, repo: Path) -> str:
    rel = os.path.relpath(root, repo)
    return "" if rel == "." else rel


# -- proposals -------------------------------------------------------------------------


def ensure_proposal(root: Path, name: str, env: dict | None = None) -> tuple[Path | None, str, str | None]:
    """The worktree for `name`, created from origin's newest default branch when
    absent → (worktree, branch, error)."""
    repo = repo_root(root) or root
    branch = branch_name(name)
    target = proposal_dir(root, name, env)
    existing = _worktree_paths(repo)
    if branch in existing and Path(existing[branch]).is_dir():
        return Path(existing[branch]), branch, None
    if target.exists():  # a stale folder whose worktree registration is gone
        run_git(repo, "worktree", "prune")
        shutil.rmtree(target, ignore_errors=True)
    default = default_branch(repo)
    if default is None:
        return None, branch, "cannot tell origin's default branch"
    base = _rev(repo, f"origin/{default}")
    if base is None:
        return None, branch, f"origin/{default} is not fetched — fetch failed and nothing is cached"
    target.parent.mkdir(parents=True, exist_ok=True)
    if _rev(repo, branch):  # the branch survives a removed worktree: check it out again
        code, _, err = run_git(repo, "worktree", "add", str(target), branch)
    else:
        code, _, err = run_git(repo, "worktree", "add", "-b", branch, str(target), base)
    if code != 0:
        return None, branch, f"could not create the proposal worktree: {err.strip()}"
    if _proposal_base(target) is None:
        _record(target, "brainpick.proposal.base", base)
    return target, branch, None


def describe_proposal(root: Path, name: str, env: dict | None = None) -> dict | None:
    """The `proposal` block: branch, base, commits, files, stale_base, worktree."""
    repo = repo_root(root) or root
    branch = branch_name(name)
    paths = _worktree_paths(repo)
    tip = _rev(repo, branch)
    if tip is None:
        return None
    worktree = Path(paths[branch]) if branch in paths else proposal_dir(root, name, env)
    base = _proposal_base(worktree) if worktree.is_dir() else None
    default = default_branch(repo)
    upstream_tip = _rev(repo, f"origin/{default}") if default else None
    if base is None:
        code, out, _ = run_git(repo, "merge-base", branch, f"origin/{default}") if default else (1, "", "")
        base = out.strip() if code == 0 and out.strip() else tip
    code, out, _ = run_git(repo, "rev-list", "--count", f"{base}..{branch}")
    commits = int(out.strip()) if code == 0 and out.strip().isdigit() else 0
    code, out, _ = run_git(repo, "diff", "--name-only", f"{base}..{branch}")
    rel = _bundle_rel(root, repo)
    files = sorted(
        (f[len(rel) + 1:] if rel and f.startswith(rel + "/") else f)
        for f in out.split("\n") if f.strip() and "/.brainpick/" not in f"/{f}"
    )
    stale = bool(upstream_tip and base and upstream_tip != base
                 and run_git(repo, "merge-base", "--is-ancestor", base, upstream_tip)[0] == 0)
    merged = bool(upstream_tip and commits > 0
                  and run_git(repo, "merge-base", "--is-ancestor", branch, upstream_tip)[0] == 0)
    out_dict = {"name": slugify(name), "branch": branch, "base": (base or "")[:8], "commits": commits,
                "stale_base": stale, "merged": merged, "files": files, "worktree": str(worktree)}
    if worktree.is_dir():
        rung = _read(worktree, "brainpick.submitted.rung")
        if rung:
            submitted = {"rung": rung}
            url = _read(worktree, "brainpick.submitted.url")
            if url:
                key = {"forge-cli": "pr_url", "fork-remote": "compare_url", "patch": "patch_path"}[rung] \
                    if rung in ("forge-cli", "fork-remote", "patch") else "url"
                submitted[key] = url
            out_dict["submitted"] = submitted
    return out_dict


def list_proposals(root: str | Path, env: dict | None = None) -> list[dict]:
    """Every proposal of this brain's repository — from its `contrib/*` branches."""
    root = Path(root).resolve()
    if not is_repo(root):
        return []
    repo = repo_root(root) or root
    code, out, _ = run_git(repo, "for-each-ref", "--format=%(refname:short)", f"refs/heads/{BRANCH_PREFIX}")
    if code != 0:
        return []
    result = []
    for ref in out.split():
        described = describe_proposal(root, ref[len(BRANCH_PREFIX):], env)
        if described:
            result.append(described)
    return result


def read_first_for(root: Path) -> list[str]:
    """The implant's own contribution guide: [brain] contributing, else
    CONTRIBUTING.md at the repo root, else the bundle's conventions/index.md."""
    from brainpick.config import load_config

    repo = repo_root(root) or root
    for candidate in (root, repo):
        try:
            declared = getattr(load_config(candidate).brain, "contributing", [])
        except Exception:  # noqa: BLE001
            declared = []
        if declared:
            return list(declared)
    if (repo / "CONTRIBUTING.md").is_file():
        return ["CONTRIBUTING.md"]
    if (root / "conventions" / "index.md").is_file():
        return ["conventions/index.md"]
    return []


# -- brain_contribute ------------------------------------------------------------------


def contribute(state, doc: str, content: str, mode: str = "create", base_sha: str | None = None,
               budget_tokens: int | None = None, message: str = "", proposal: str | None = None,
               env: dict | None = None) -> dict:
    """spec/105 brain_contribute: fetch, branch from origin's newest default, guarded
    write in the worktree against the TARGET's contract, compile, commit — the served
    checkout untouched throughout."""
    from brainpick.compile.pipeline import run_compile
    from brainpick.config import load_config
    from brainpick.mcp_server import guarded_write
    from brainpick.serve.state import ServeState

    root = Path(state.root).resolve()
    repo = repo_root(root) or root
    result: dict = {"ok": False, "brain": root.name, "hint": ""}
    if not is_repo(root):
        result["hint"] = "not a git repository — a proposal needs a repository to branch."
        return result
    if not _has_remote(repo):
        result["hint"] = ("no remote called origin — a proposal is made against the upstream "
                          "repository this checkout was cloned from, and there is none.")
        return result
    if not str(message).strip():
        result["hint"] = ("a commit message is required — an engine never invents one for "
                          "shared memory (spec/100).")
        return result

    name = slugify(proposal or Path(doc.split(":", 1)[-1]).stem)
    fetch_note = ""
    code, _, err = run_git(repo, "fetch", "--quiet", "origin")
    if code != 0:
        fetch_note = f" (fetch failed: {err.strip() or 'unknown'} — branched from origin as last fetched)"

    worktree, branch, error = ensure_proposal(root, name, env)
    if worktree is None:
        result["hint"] = error + fetch_note
        return result
    bundle = worktree / _bundle_rel(root, repo) if _bundle_rel(root, repo) else worktree
    wt_state = ServeState(bundle, load_config(worktree if (worktree / "brainpick.toml").is_file() else bundle))
    own_setting = wt_state.config.validate.henxels  # the target's own choice, honoured below
    wt_state.config.validate.henxels = "never"  # the whole contract runs below, over the worktree

    status, payload = guarded_write(wt_state, doc, content, mode, base_sha, budget_tokens)
    if status == "conflict":
        payload["hint"] = (payload.get("hint") or "") + " (against the proposal's copy of the doc)"
        return payload
    if status != "ok":
        return {"ok": False, "brain": root.name, "instruction": payload["instruction"]}
    rel = payload["path"]

    wt_state.config.validate.henxels = own_setting  # else run_contract would skip it
    outcome, detail = run_contract(bundle, wt_state.config)
    if outcome in ("unavailable", "fail"):
        run_git(worktree, "checkout", "--", ".")  # the doc stays unwritten in the proposal
        run_git(worktree, "clean", "-fdq", "--", rel)
        result.update({"contract": outcome, "instruction": detail,
                       "hint": ("the target's contract could not be run — refusing to propose."
                                if outcome == "unavailable" else
                                "the target's own henxels contract rejected this change — "
                                "fix it and call brain_contribute again.")})
        return result
    try:
        run_compile(bundle, config=wt_state.config)  # so a --check-fresh hook passes
    except Exception:  # noqa: BLE001
        pass

    _record(worktree, "brainpick.proposal.contract", outcome)
    # Never the disposable artifacts: an implant without a .gitignore would otherwise
    # ship its compiled .brainpick/ in the proposal.
    run_git(worktree, "add", "-A", "--", ".", ":(exclude,glob)**/.brainpick/**", ":(exclude,glob).brainpick/**")
    code, out, err = run_git(worktree, "commit", "-m", str(message).strip())
    if code != 0:
        result.update({"contract": "fail", "instruction": (out + err).strip(),
                       "hint": "the commit was rejected by a hook (hooks always run) — the change "
                               "is left uncommitted in the proposal worktree; fix and call again."})
        return result

    described = describe_proposal(root, name, env) or {}
    read_first = read_first_for(root)
    stale = " The proposal's base is STALE — upstream moved on; drop and redo, or submit and let the maintainer rebase." \
        if described.get("stale_base") else ""
    guide = " Read read_first: the implant's own rules for contributions." if read_first else ""
    result.update({
        "ok": True, "proposal": described, "contract": outcome, "read_first": read_first,
        "hint": (f"{described.get('commits', 1)} commit(s) on {branch} (in your working copy for "
                 f"this proposal — a git worktree — not in the mounted brain). Add more with "
                 f"proposal='{name}', then brain_submit to open the pull request.{stale}{guide}"
                 f"{fetch_note}"),
    })
    return result


def drop_proposal(state, name: str, env: dict | None = None) -> dict:
    """Remove a proposal's worktree and branch. Nothing is ever dropped automatically."""
    root = Path(state.root).resolve()
    repo = repo_root(root) or root
    branch = branch_name(name)
    paths = _worktree_paths(repo)
    if branch not in paths and _rev(repo, branch) is None:
        return {"ok": False, "brain": root.name, "hint": f"no proposal called '{slugify(name)}'."}
    if branch in paths:
        run_git(repo, "worktree", "remove", "--force", paths[branch])
    run_git(repo, "worktree", "prune")
    run_git(repo, "branch", "-D", branch)
    return {"ok": True, "brain": root.name, "proposal": slugify(name),
            "hint": f"dropped {branch} and its worktree."}


# -- brain_submit ----------------------------------------------------------------------


def _forge(origin_url: str) -> tuple[str, str, str] | None:
    """(host, owner, repo) of a GitHub/Gitea-shaped origin URL, else None."""
    m = re.match(r"^(?:https?://|git@|ssh://git@)([^/:]+)[/:]([^/]+)/([^/]+?)(?:\.git)?/?$", origin_url)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def _web_url(origin_url: str) -> str | None:
    parts = _forge(origin_url)
    if not parts:
        return None
    host, owner, repo = parts
    return f"https://{host}/{owner}/{repo}"


def _run(cmd: list[str], cwd: Path, timeout: int = 120) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, "", str(exc)
    return proc.returncode, proc.stdout, proc.stderr


def _forge_cli(host: str) -> str | None:
    """`gh` for GitHub, `tea` for Gitea — on PATH and authenticated, else None."""
    if host == "github.com" or host.startswith("github."):
        name = "gh"
    else:
        name = "tea"
    exe = shutil.which(name)
    if exe is None:
        return None
    check = ["auth", "status"] if name == "gh" else ["logins", "list"]
    code, _, _ = _run([exe, *check], cwd=Path.cwd(), timeout=30)
    return exe if code == 0 else None


def _fork_owner(repo: Path) -> str | None:
    code, out, _ = run_git(repo, "remote", "get-url", "fork")
    parts = _forge(out.strip()) if code == 0 else None
    return parts[1] if parts else None


def draft_body(root: Path, described: dict, contract: str, what: str | None) -> str:
    """Only from data the engine has: the commit messages, the files, the checks."""
    repo = repo_root(root) or root
    if what is None:
        code, out, _ = run_git(repo, "log", "--reverse", "--format=%s", f"{described['base']}..{described['branch']}")
        lines = [f"- {line}" for line in out.splitlines() if line.strip()] if code == 0 else []
        what = "\n".join(lines) or "- (see commits)"
    pages = "\n".join(f"- {f}" for f in described["files"]) or "- (none)"
    return (
        f"## What\n{what}\n\n"
        f"## Pages\n{pages}\n\n"
        f"## Checks (run locally, the implant's own contract)\n"
        f"- henxels contract: {contract}\n"
        f"- brainpick compile --check-fresh: pass\n"
        f"- base: {described['base']} (origin's default branch at proposal time"
        f"{'; upstream has moved since' if described['stale_base'] else ''})\n\n"
        "_Proposed through brainpick brain_contribute. The checks are the implant's own "
        "contract; the claims are the contributor's._\n"
    )


def submit(state, name: str, title: str | None = None, body: str | None = None,
           env: dict | None = None) -> dict:
    """spec/105 brain_submit: send the proposal to the agent's own copy (fork) —
    forge CLI, else a `fork` remote, else a patch file. Origin is never written."""
    root = Path(state.root).resolve()
    repo = repo_root(root) or root
    name = slugify(name)
    result: dict = {"ok": False, "brain": root.name, "proposal": name, "hint": ""}
    described = describe_proposal(root, name, env)
    if described is None or described["commits"] == 0:
        result["hint"] = f"no proposal called '{name}' with commits — brain_contribute first."
        return result
    worktree = Path(described["worktree"])
    branch = described["branch"]
    run_git(repo, "fetch", "--quiet", "origin")
    described = describe_proposal(root, name, env) or described

    code, out, _ = run_git(repo, "log", "-1", "--format=%s", branch)
    title = (title or "").strip() or (out.strip() if code == 0 else name)
    contract = (_read(worktree, "brainpick.proposal.contract") if worktree.is_dir() else None) or "pass"
    full_body = draft_body(root, described, contract, body.strip() if body else None)
    result.update({"title": title, "body": full_body, "stale_base": described["stale_base"]})
    stale = " Upstream has moved since this proposal was based; the maintainer may need to rebase." \
        if described["stale_base"] else ""

    code, out, _ = run_git(repo, "remote", "get-url", "origin")
    origin_url = out.strip() if code == 0 else ""
    parts = _forge(origin_url)
    web = _web_url(origin_url)
    default = default_branch(repo) or "main"

    # Rung 1 — forge CLI: fork once, push the branch to the fork, open the pull request.
    exe = _forge_cli(parts[0]) if parts else None
    if exe is not None:
        if not _has_remote(repo, "fork"):
            fork_cmd = ([exe, "repo", "fork", "--remote", "--remote-name", "fork"] if exe.endswith("gh")
                        else [exe, "repo", "fork", "--remote", "fork"])
            _run(fork_cmd, cwd=repo)
        if _has_remote(repo, "fork"):
            code, _, err = run_git(repo, "push", "-u", "fork", branch)
            if code == 0:
                owner = _fork_owner(repo) or ""
                pr_cmd = [exe, "pr", "create", "--title", title, "--body", full_body,
                          "--base", default, "--head", f"{owner}:{branch}" if owner else branch]
                code, out, err = _run(pr_cmd, cwd=worktree if worktree.is_dir() else repo)
                if code == 0:
                    url = next((tok for tok in out.split() if tok.startswith("http")), out.strip())
                    m = _PR_NUMBER.search(url)
                    number = int(m.group(1) or m.group(2)) if m else None
                    if worktree.is_dir():
                        _record(worktree, "brainpick.submitted.rung", "forge-cli")
                        _record(worktree, "brainpick.submitted.url", url)
                    result.update({"ok": True, "rung": "forge-cli", "pr_url": url, "number": number,
                                   "hint": f"opened the pull request {url} from your fork's {branch} — "
                                           f"the original repository (origin) was not written.{stale}"})
                    return result
                result["forge_error"] = (err or out).strip()
            elif _push_denied(err):
                result["forge_error"] = f"push to fork denied: {err.strip()}"

    # Rung 2 — a fork remote: push the branch, hand back the compare URL.
    if _has_remote(repo, "fork"):
        code, _, err = run_git(repo, "push", "-u", "fork", branch)
        if code == 0:
            owner = _fork_owner(repo) or "<your-fork>"
            compare = (f"{web}/compare/{default}...{owner}:{branch}?expand=1" if web
                       else f"compare {default}...{owner}:{branch} on the forge")
            if worktree.is_dir():
                _record(worktree, "brainpick.submitted.rung", "fork-remote")
                _record(worktree, "brainpick.submitted.url", compare)
            result.update({"ok": True, "rung": "fork-remote", "compare_url": compare,
                           "hint": (f"pushed {branch} to your own copy (the fork remote); the original "
                                    f"(origin) was not written. Open the pull request at compare_url and "
                                    f"paste title and body.{stale}")})
            return result
        result["fork_error"] = err.strip()

    # Rung 3 — a patch: nothing needs a forge account.
    patch_dir = worktree.parent if worktree.is_dir() else proposals_home(env) / _brain_key(root)
    patch_dir.mkdir(parents=True, exist_ok=True)
    patch_path = patch_dir / f"{name}.patch"
    code, out, err = run_git(repo, "format-patch", "--stdout", f"{described['base']}..{branch}")
    if code != 0:
        result["hint"] = f"format-patch failed: {err.strip()}"
        return result
    patch_path.write_text(out, encoding="utf-8")
    if worktree.is_dir():
        _record(worktree, "brainpick.submitted.rung", "patch")
        _record(worktree, "brainpick.submitted.url", str(patch_path))
    where = f" ({web})" if web else ""
    result.update({"ok": True, "rung": "patch", "patch_path": str(patch_path), "origin": origin_url,
                   "hint": (f"no forge tool (gh/tea) and no fork remote here — wrote the change as a "
                            f"patch file to {patch_path}. Attach it to an issue on the original "
                            f"repository{where} or send it to its maintainers with the title and body "
                            f"drafted above; nothing was pushed anywhere.{stale}")})
    return result


def proposals_hint(proposals: list[dict]) -> str:
    merged = [p["name"] for p in proposals if p["merged"]]
    stale = [p["name"] for p in proposals if p["stale_base"] and not p["merged"]]
    parts = [f"{len(proposals)} proposal(s) ({', '.join(p['name'] for p in proposals)})"]
    if merged:
        parts.append(f"merged upstream: {', '.join(merged)} — drop them with brain_contribute drop=true")
    if stale:
        parts.append(f"stale base: {', '.join(stale)}")
    return "; ".join(parts) + "."


__all__ = ["contribute", "drop_proposal", "list_proposals", "proposal_dir", "proposals_hint",
           "read_first_for", "submit", "READ_ONLY"]
