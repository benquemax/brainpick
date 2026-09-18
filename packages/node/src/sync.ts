/** Sync (spec/100): the git verbs behind brain_status / brain_sync / brain_push.
 *
 * The twin of packages/python/src/brainpick/sync.py. A brain is shared memory
 * held in Git, but the tools stopped at the checkout: an agent could consult and
 * write a brain over MCP and then had to shell out to git to share it. This is
 * the narrow, audited surface that closes that gap — three complete operations
 * on one bundle's repository, never a general git tool.
 *
 * Two rules shape everything here:
 *
 * - **Git failures are data.** Every helper returns a status rather than
 *   throwing: a brain that is not a repo, has no remote, or sits mid-conflict is
 *   a legitimate state an agent must be told about, not an exception that kills
 *   the call.
 * - **Conflict markers never reach a doc.** Resolution is doc-wise through the
 *   spec/70 proposal ladder, whose three inputs git's merge index already holds:
 *   stage 1/2/3 = base/ours/theirs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve as resolvePath } from "node:path";

import { checkFresh, runCompile } from "./compile/pipeline";
import { detectHenxels, findHenxels, which } from "./detect";
import { makeChat } from "./llm";
import { resolve as resolveMerge } from "./merge";
import type { ServeState } from "./serve/state";

export const GIT_TIMEOUT = 30_000; // generous: fetch talks to a network

export class GitUnavailable extends Error {}

export type GitResult = { code: number; stdout: string; stderr: string };

/** {code, stdout, stderr}. A non-zero exit is DATA, not an exception: every verb
 * in spec/100 reports git's refusal rather than propagating it. */
export function runGit(root: string, args: string[], timeout = GIT_TIMEOUT): GitResult {
  const git = which("git");
  if (git === null) throw new GitUnavailable("git is not installed or not on PATH");
  const proc = spawnSync(git, ["-C", root, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error !== undefined) {
    return { code: 1, stdout: "", stderr: String((proc.error as Error).message) };
  }
  return { code: proc.status ?? 1, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

export function isRepo(root: string): boolean {
  const { code, stdout } = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return code === 0 && stdout.trim() === "true";
}

export function repoRoot(root: string): string | null {
  const { code, stdout } = runGit(root, ["rev-parse", "--show-toplevel"]);
  return code === 0 && stdout.trim() ? stdout.trim() : null;
}

export function currentBranch(root: string): string | null {
  const { code, stdout } = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = stdout.trim();
  return code === 0 && branch && branch !== "HEAD" ? branch : null;
}

export function upstreamOf(root: string): string | null {
  const { code, stdout } = runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  return code === 0 && stdout.trim() ? stdout.trim() : null;
}

/** [ahead, behind] against the upstream; [0, 0] when there is none. */
export function aheadBehind(root: string): [number, number] {
  const { code, stdout } = runGit(root, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
  if (code !== 0) return [0, 0];
  const parts = stdout.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return [0, 0];
  const behind = Number(parts[0]);
  const ahead = Number(parts[1]);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return [0, 0];
  return [ahead, behind];
}

/** [[xy, path]] from `status --porcelain` — the two status columns and the path. */
export function porcelain(root: string, pathspec?: string): [string, string][] {
  const args = ["status", "--porcelain", "-z"];
  if (pathspec !== undefined) args.push("--", pathspec);
  const { code, stdout } = runGit(root, args);
  if (code !== 0) return [];
  const entries: [string, string][] = [];
  const records = stdout.split("\0").filter((r) => r !== "");
  let skipNext = false;
  for (const record of records) {
    if (skipNext) {
      // the rename/copy source follows its entry as its own record
      skipNext = false;
      continue;
    }
    if (record.length < 4) continue;
    const xy = record.slice(0, 2);
    const path = record.slice(3);
    if (xy[0] === "R" || xy[0] === "C") skipNext = true;
    entries.push([xy, path]);
  }
  return entries;
}

/** Paths left unmerged, sorted. `diff --diff-filter=U` is exact — porcelain's
 * UU/AA/DD codes miss some of the rarer unmerged combinations. */
export function conflictedPaths(root: string): string[] {
  const { code, stdout } = runGit(root, ["diff", "--name-only", "--diff-filter=U"]);
  if (code !== 0) return [];
  return stdout.split("\n").filter(Boolean).sort();
}

export type MergeStages = { base: string | null; yours: string | null; theirs: string | null };

/** {base, yours, theirs} for a conflicted path, read from the merge index.
 *
 * spec/100's load-bearing mapping: git's index stages are exactly the ladder's
 * three inputs — :1: the merge base, :2: ours, :3: theirs. A stage that does not
 * exist (a file added on both sides has no ancestor) is null, and the ladder
 * degrades to the two-input merge rather than inventing a base. */
export function mergeStages(root: string, rel: string): MergeStages {
  const pathspec = rel.replace(/\\/g, "/");
  const read = (stage: number): string | null => {
    const { code, stdout } = runGit(root, ["show", `:${stage}:${pathspec}`]);
    return code === 0 ? stdout : null;
  };
  return { base: read(1), yours: read(2), theirs: read(3) };
}

export type Dirty = { modified: number; untracked: number; staged: number };
export type StatusPayload = {
  repo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: Dirty;
  conflicts: string[];
  clean: boolean;
  hint: string;
};

/** spec/100 brain_status: the checkout's relationship to its remote.
 *
 * Never fetches — the caller decides whether to touch the network, because a
 * fetch is the one part of status that can be slow or fail. */
export function gitStatus(root: string): StatusPayload {
  if (!isRepo(root)) {
    return {
      repo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      dirty: { modified: 0, untracked: 0, staged: 0 },
      conflicts: [],
      clean: true,
      hint: "not a git repository — this brain is local only; nothing to sync or push.",
    };
  }
  const branch = currentBranch(root);
  const upstream = upstreamOf(root);
  const [ahead, behind] = upstream !== null ? aheadBehind(root) : [0, 0];
  const conflicts = conflictedPaths(root);

  let modified = 0;
  let untracked = 0;
  let staged = 0;
  for (const [xy] of porcelain(root)) {
    if (xy === "??") {
      untracked += 1;
      continue;
    }
    if (xy[0] !== " " && xy[0] !== "?") staged += 1;
    if (xy[1] !== " " && xy[1] !== "?") modified += 1;
  }
  const dirty = { modified, untracked, staged };
  const anyDirty = modified + untracked + staged > 0;
  const clean = ahead === 0 && behind === 0 && conflicts.length === 0 && !anyDirty;
  return {
    repo: true,
    branch,
    upstream,
    ahead,
    behind,
    dirty,
    conflicts,
    clean,
    hint: statusHint(upstream, ahead, behind, dirty, conflicts, clean),
  };
}

function statusHint(
  upstream: string | null,
  ahead: number,
  behind: number,
  dirty: Dirty,
  conflicts: string[],
  clean: boolean,
): string {
  if (conflicts.length > 0) {
    const n = conflicts.length;
    return (
      `${n} path${n !== 1 ? "s" : ""} still conflicted — resolve them ` +
      `(brain_sync proposes merges), then brain_push.`
    );
  }
  if (upstream === null) {
    return (
      "no upstream — this checkout tracks no remote branch; " +
      "nothing to pull, and brain_push has nowhere to send."
    );
  }
  if (clean) return "in sync with the remote, nothing to do.";
  const parts: string[] = [];
  if (behind > 0) parts.push(`${behind} commit${behind !== 1 ? "s" : ""} behind — run brain_sync`);
  if (ahead > 0) parts.push(`${ahead} commit${ahead !== 1 ? "s" : ""} ahead — run brain_push`);
  if (dirty.modified + dirty.untracked + dirty.staged > 0) {
    parts.push(
      `uncommitted changes (${dirty.modified} modified, ${dirty.staged} staged, ` +
        `${dirty.untracked} untracked)`,
    );
  }
  return `${parts.join("; ")}.`;
}

// -- brain_sync ---------------------------------------------------------------

/** Trim a doc for a payload. Only the REPORTED copies are shaped — a trimmed
 * merge proposal written back would be a corrupted doc. */
function budgetShape(text: string | null, limit = 4000): string {
  if (!text) return "";
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (trimmed)`;
}

export type SyncPayload = {
  ok: boolean;
  brain: string;
  behind_before: number;
  merged: { path: string; strategy: string }[];
  unresolved: { path: string; theirs: string; yours: string; reason: string }[];
  committed: boolean;
  hint: string;
};

/** spec/100 brain_sync: bring the remote's work in, resolve what collides
 * doc-wise, recompile — and commit NOTHING. */
export async function syncBrain(state: ServeState, _budgetTokens?: number | null): Promise<SyncPayload> {
  const root = state.root;
  const repo = repoRoot(root) ?? root;
  const result: SyncPayload = {
    ok: false,
    brain: basenameOf(root),
    behind_before: 0,
    merged: [],
    unresolved: [],
    committed: false,
    hint: "",
  };

  if (!isRepo(root)) {
    result.hint = "not a git repository — nothing to sync.";
    return result;
  }
  if (upstreamOf(repo) === null) {
    result.hint =
      "no upstream — this checkout tracks no remote branch; set one with `git branch --set-upstream-to`.";
    return result;
  }

  const fetched = runGit(repo, ["fetch", "--quiet"]);
  if (fetched.code !== 0) {
    result.hint = `fetch failed: ${fetched.stderr.trim() || "unknown error"}`;
    return result;
  }

  const [, behind] = aheadBehind(repo);
  result.behind_before = behind;
  if (behind === 0) {
    result.ok = true;
    result.hint = "already up to date with the remote.";
    return result;
  }

  // A dirty tree cannot be merged into; stash for the duration and restore after.
  let stashed = false;
  if (porcelain(repo).some(([xy]) => xy !== "??")) {
    const push = runGit(repo, ["stash", "push", "-m", "brainpick-sync"]);
    stashed = push.code === 0 && !push.stdout.includes("No local changes");
  }

  const merge = runGit(repo, ["merge", "--no-commit", "--no-ff", "@{u}"]);
  const conflicts = conflictedPaths(repo);
  if (merge.code !== 0 && conflicts.length === 0) {
    runGit(repo, ["merge", "--abort"]);
    if (stashed) runGit(repo, ["stash", "pop"]);
    result.hint = `merge failed: ${merge.stderr.trim() || "unknown error"}`;
    return result;
  }

  const chat = makeChat(state.config.models.extraction);
  for (const rel of conflicts) {
    const stages = mergeStages(repo, rel);
    const proposal = await resolveMerge(stages.base, stages.theirs ?? "", stages.yours ?? "", chat);
    if (proposal === null) {
      // spec/100: never leave markers in a doc. Restore ours and report.
      runGit(repo, ["checkout", "--ours", "--", rel]);
      runGit(repo, ["add", "--", rel]);
      result.unresolved.push({
        path: rel,
        theirs: budgetShape(stages.theirs),
        yours: budgetShape(stages.yours),
        reason:
          "edits overlap and no [models.extraction] chat model is configured — " +
          "reconcile by hand, then brain_write",
      });
      continue;
    }
    writeFileSync(resolvePath(repo, rel), proposal.content, "utf8");
    runGit(repo, ["add", "--", rel]);
    result.merged.push({ path: rel, strategy: proposal.strategy });
  }

  if (stashed) runGit(repo, ["stash", "pop"]);

  try {
    await runCompile(root, false, null, state.config);
  } catch {
    // a compile problem is reported by the next read
  }
  await state.load();

  result.ok = true;
  result.hint = syncHint(result);
  return result;
}

function syncHint(result: SyncPayload): string {
  const parts = [`pulled ${result.behind_before} commit${result.behind_before !== 1 ? "s" : ""}`];
  if (result.merged.length > 0) {
    parts.push(
      `${result.merged.length} doc${result.merged.length !== 1 ? "s" : ""} merged ` +
        `(${result.merged.map((m) => m.path).join(", ")}) — REVIEW before pushing, nothing was committed`,
    );
  }
  if (result.unresolved.length > 0) {
    parts.push(
      `${result.unresolved.length} unresolved (${result.unresolved.map((u) => u.path).join(", ")}) ` +
        `— reconcile with brain_write, then brain_push`,
    );
  }
  if (result.merged.length === 0 && result.unresolved.length === 0) parts.push("no conflicts");
  return `${parts.join("; ")}.`;
}

// -- brain_push ---------------------------------------------------------------

export type ContractOutcome = "pass" | "fail" | "unavailable" | "none";

/** spec/100's contract gate → [outcome, detail].
 *
 * The distinction that matters is `unavailable` vs `pass`: the henxels-managed
 * hook prints a warning and EXITS 0 when it cannot resolve the executable, so a
 * commit lands with the contract unenforced — and an MCP server is the process
 * most likely to carry exactly that stripped PATH. A push whose contract was
 * skipped is not a verified push. */
export function runContract(root: string, config?: { validate?: { henxels?: string } }): [ContractOutcome, string | null] {
  if (config?.validate?.henxels === "never") return ["none", null];
  const contract = detectHenxels(root);
  if (contract === null && !existsSync(resolvePath(root, ".henxels"))) {
    return ["none", null]; // no contract to run — NOT a contract that was skipped
  }
  const executable = findHenxels();
  if (executable === null) {
    return [
      "unavailable",
      "the henxels contract governs this bundle but the henxels CLI could not be found " +
        "(PATH or the per-user launcher dirs). Install it — `uv tool install henxels` — or " +
        "commit and push from a shell where it is available. Refusing to publish an " +
        "unverified commit.",
    ];
  }
  const cwd = contract !== null ? dirnameOf(contract) : root;
  const target = relative(cwd, root) || ".";
  const proc = spawnSync(executable, ["check", target], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error !== undefined) return ["unavailable", `could not run henxels: ${String(proc.error)}`];
  if (proc.status !== 0) {
    return ["fail", `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim() || "henxels check failed"];
  }
  return ["pass", null];
}

export type PushPayload = {
  ok: boolean;
  brain: string;
  commit: string | null;
  pushed: boolean;
  hint: string;
  contract?: ContractOutcome;
  instruction?: string | null;
};

/** spec/100 brain_push: compile, run the contract, stage the bundle, commit, push.
 * Hooks always run — no engine may pass --no-verify. */
export async function pushBrain(state: ServeState, message: string): Promise<PushPayload> {
  const root = state.root;
  const repo = repoRoot(root) ?? root;
  const result: PushPayload = { ok: false, brain: basenameOf(root), commit: null, pushed: false, hint: "" };

  if (!isRepo(root)) {
    result.hint = "not a git repository — nothing to push.";
    return result;
  }
  if (!String(message ?? "").trim()) {
    result.hint = "a commit message is required — an engine never invents one for shared memory.";
    return result;
  }

  // Fetch first: `behind` is meaningless against a stale remote-tracking ref, and
  // refusing to push when behind is the check that keeps this tool from ever
  // pulling on the agent's behalf. A fetch failure is not fatal — an offline
  // machine may still legitimately commit and fail at the push.
  runGit(repo, ["fetch", "--quiet"]);
  const status = gitStatus(repo);
  if (status.conflicts.length > 0) {
    result.hint =
      `${status.conflicts.length} path(s) still in conflict (${status.conflicts.join(", ")}) — ` +
      `unresolved work is never published; resolve, then push.`;
    return result;
  }
  if (status.upstream === null) {
    result.hint = "no upstream — this checkout tracks no remote branch.";
    return result;
  }
  if (status.behind > 0) {
    result.hint =
      `${status.behind} commit(s) behind the remote — run brain_sync first; ` +
      `this tool never pulls on your behalf.`;
    return result;
  }

  // Compile BEFORE committing: a contract running --check-fresh on pre-commit would
  // otherwise reject the very commit this tool is making.
  try {
    await runCompile(root, false, null, state.config);
  } catch {
    // reported by the next read
  }

  const [outcome, detail] = runContract(root, state.config as { validate?: { henxels?: string } });
  if (outcome === "unavailable") {
    result.contract = "unavailable";
    result.instruction = detail;
    result.hint = "the contract could not be run — refusing to push.";
    return result;
  }
  if (outcome === "fail") {
    result.contract = "fail";
    result.instruction = detail;
    result.hint = "the henxels contract rejected this bundle — fix it, then push.";
    return result;
  }
  result.contract = outcome;

  // Stage the BUNDLE, never the whole repo: a brain repo may hold files that are not
  // the brain, and a tool that publishes on an agent's word must not sweep up work
  // nobody reviewed.
  const pathspec = relative(repo, root) || ".";
  const added = runGit(repo, ["add", "--", pathspec]);
  if (added.code !== 0) {
    result.hint = `git add failed: ${added.stderr.trim()}`;
    return result;
  }

  const staged = runGit(repo, ["diff", "--cached", "--name-only", "--", pathspec]);
  if (!staged.stdout.trim()) {
    if (status.ahead > 0) {
      const pushed = runGit(repo, ["push"]);
      if (pushed.code !== 0) {
        result.hint = `push failed: ${pushed.stderr.trim()}`;
        return result;
      }
      result.ok = true;
      result.pushed = true;
      result.commit = runGit(repo, ["rev-parse", "HEAD"]).stdout.trim();
      result.hint = `pushed ${status.ahead} existing commit(s); nothing new to commit.`;
      return result;
    }
    result.hint = "nothing to push — no changes in the bundle and nothing ahead.";
    return result;
  }

  const committed = runGit(repo, ["commit", "-m", String(message).trim()]);
  if (committed.code !== 0) {
    result.contract = "fail";
    result.instruction = `${committed.stdout}${committed.stderr}`.trim();
    result.hint = "the commit was rejected (hooks run — never bypassed).";
    return result;
  }
  const commit = runGit(repo, ["rev-parse", "HEAD"]).stdout.trim();

  const pushed = runGit(repo, ["push"]);
  if (pushed.code !== 0) {
    result.commit = commit;
    result.hint = `committed ${commit.slice(0, 8)} but the push failed: ${(pushed.stderr || pushed.stdout).trim()}`;
    return result;
  }
  result.ok = true;
  result.commit = commit;
  result.pushed = true;
  result.hint = `committed ${commit.slice(0, 8)} and pushed to ${status.upstream}.`;
  return result;
}

function basenameOf(p: string): string {
  const parts = p.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? p;
}

function dirnameOf(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  return cut <= 0 ? "/" : normalized.slice(0, cut);
}

export { checkFresh, statSync };
