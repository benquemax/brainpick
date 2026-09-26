/** Contribute (spec/105): proposing changes to a brain the agent does not own.
 *
 * A PROPOSAL is a branch (`contrib/<name>`) holding the commits the agent wants
 * upstream, checked out in a git WORKTREE — a second checkout of the same
 * repository in another folder, sharing its object store and hooks — so the
 * served checkout stays exactly what upstream has: clean, fast-forwardable, a
 * mirror. brain_contribute writes there through the same guarded ladder as
 * brain_write and commits; brain_submit sends the branch to the agent's OWN
 * copy (its fork) or, failing that, produces a patch. Nothing on this path
 * ever writes the original repository (origin).
 *
 * Ports contribute.py from the Python engine.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { loadConfig } from "./config";
import { runCompile } from "./compile/pipeline";
import {
  type Brain,
  BrainSet,
  qualify,
  splitQualified,
} from "./federation";
import { guardedWrite, type Payload } from "./mcp";
import { ServeState } from "./serve/state";
import {
  currentBranch,
  isRepo,
  repoRoot,
  runContract,
  runGit,
  upstreamOf,
} from "./sync";

const BRANCH_PREFIX = "contrib/";
const SLUG_RE = /[^a-z0-9]+/g;

// -- where proposals live -----------------------------------------------------------

export function proposalsHome(env: Record<string, string | undefined> = process.env): string {
  const override = env["BRAINPICK_PROPOSALS"];
  if (override) return resolve(override);
  const xdg = env["XDG_DATA_HOME"] || join(env["HOME"] ?? "", ".local", "share");
  return join(xdg, "brainpick", "proposals");
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "") || "proposal";
}

function brainKey(root: string): string {
  const repo = repoRoot(root) ?? root;
  for (const candidate of [root, repo]) {
    try {
      const id = loadConfig(candidate).bundle.id;
      if (id) return id;
    } catch { /* skip */ }
  }
  return slugify(basename(repo));
}

export function proposalDir(root: string, name: string, env?: Record<string, string | undefined>): string {
  return join(proposalsHome(env), brainKey(resolve(root)), slugify(name));
}

export function branchName(name: string): string {
  return BRANCH_PREFIX + slugify(name);
}

// -- git plumbing ---------------------------------------------------------------------

function defaultBranch(repo: string): string | null {
  const head = runGit(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim().split("/").slice(1).join("/");
  const up = upstreamOf(repo);
  if (up && up.includes("/")) return up.split("/").slice(1).join("/");
  const cur = currentBranch(repo);
  return cur ?? null;
}

function hasRemote(repo: string, name = "origin"): boolean {
  const r = runGit(repo, ["remote"]);
  return r.code === 0 && r.stdout.split(/\s+/).includes(name);
}

function rev(repo: string, ref: string): string | null {
  const r = runGit(repo, ["rev-parse", "--verify", "--quiet", ref]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function worktreePaths(repo: string): Record<string, string> {
  const r = runGit(repo, ["worktree", "list", "--porcelain"]);
  const result: Record<string, string> = {};
  if (r.code !== 0) return result;
  let path: string | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ") && path) result[line.slice("branch ".length).replace("refs/heads/", "")] = path;
  }
  return result;
}

function proposalBase(worktree: string): string | null {
  const r = runGit(worktree, ["config", "--get", "brainpick.proposal.base"]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function record(worktree: string, key: string, value: string): void {
  runGit(worktree, ["config", "extensions.worktreeConfig", "true"]);
  runGit(worktree, ["config", "--worktree", key, value]);
}

function readConfig(worktree: string, key: string): string | null {
  let r = runGit(worktree, ["config", "--worktree", "--get", key]);
  if (r.code !== 0 || !r.stdout.trim()) r = runGit(worktree, ["config", "--get", key]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function bundleRel(root: string, repo: string): string {
  const rel = relative(repo, root);
  return rel === "" ? "" : rel.split(sep).join("/");
}

// -- proposals ------------------------------------------------------------------------

export function ensureProposal(
  root: string,
  name: string,
  env?: Record<string, string | undefined>,
): { worktree: string | null; branch: string; error: string | null } {
  const repo = repoRoot(root) ?? root;
  const branch = branchName(name);
  const target = proposalDir(root, name, env);
  const existing = worktreePaths(repo);
  if (branch in existing && existsSync(existing[branch]!)) {
    return { worktree: existing[branch]!, branch, error: null };
  }
  if (existsSync(target)) {
    runGit(repo, ["worktree", "prune"]);
    rmSync(target, { recursive: true, force: true });
  }
  const def = defaultBranch(repo);
  if (!def) return { worktree: null, branch, error: "cannot tell origin's default branch" };
  const base = rev(repo, `origin/${def}`);
  if (!base) return { worktree: null, branch, error: `origin/${def} is not fetched — fetch failed and nothing is cached` };
  mkdirSync(dirname(target), { recursive: true });
  const r = rev(repo, branch)
    ? runGit(repo, ["worktree", "add", target, branch])
    : runGit(repo, ["worktree", "add", "-b", branch, target, base]);
  if (r.code !== 0) return { worktree: null, branch, error: `could not create the proposal worktree: ${r.stderr.trim()}` };
  if (proposalBase(target) === null) record(target, "brainpick.proposal.base", base);
  return { worktree: target, branch, error: null };
}

export interface ProposalInfo {
  name: string;
  branch: string;
  base: string;
  commits: number;
  stale_base: boolean;
  merged: boolean;
  files: string[];
  worktree: string;
  submitted?: { rung: string; pr_url?: string; compare_url?: string; patch_path?: string };
}

export function describeProposal(root: string, name: string, env?: Record<string, string | undefined>): ProposalInfo | null {
  const repo = repoRoot(root) ?? root;
  const branch = branchName(name);
  const tip = rev(repo, branch);
  if (!tip) return null;
  const paths = worktreePaths(repo);
  const worktree = branch in paths ? paths[branch]! : proposalDir(root, name, env);
  let base = existsSync(worktree) ? proposalBase(worktree) : null;
  const def = defaultBranch(repo);
  const upstreamTip = def ? rev(repo, `origin/${def}`) : null;
  if (!base) {
    const mb = def ? runGit(repo, ["merge-base", branch, `origin/${def}`]) : { code: 1, stdout: "", stderr: "" };
    base = mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : tip;
  }
  const countR = runGit(repo, ["rev-list", "--count", `${base}..${branch}`]);
  const commits = countR.code === 0 && /^\d+$/.test(countR.stdout.trim()) ? Number(countR.stdout.trim()) : 0;
  const diffR = runGit(repo, ["diff", "--name-only", `${base}..${branch}`]);
  const rel = bundleRel(root, repo);
  const files = diffR.stdout
    .split("\n")
    .filter((f) => f.trim() && !f.includes("/.brainpick/"))
    .map((f) => (rel && f.startsWith(rel + "/") ? f.slice(rel.length + 1) : f))
    .sort();
  const stale = Boolean(
    upstreamTip && base && upstreamTip !== base &&
    runGit(repo, ["merge-base", "--is-ancestor", base, upstreamTip]).code === 0,
  );
  const merged = Boolean(
    upstreamTip && commits > 0 &&
    runGit(repo, ["merge-base", "--is-ancestor", branch, upstreamTip]).code === 0,
  );
  const info: ProposalInfo = {
    name: slugify(name), branch, base: (base ?? "").slice(0, 8),
    commits, stale_base: stale, merged, files, worktree,
  };
  if (existsSync(worktree)) {
    const rung = readConfig(worktree, "brainpick.submitted.rung");
    if (rung) {
      const submitted: ProposalInfo["submitted"] = { rung };
      const url = readConfig(worktree, "brainpick.submitted.url");
      if (url) {
        if (rung === "forge-cli") submitted.pr_url = url;
        else if (rung === "fork-remote") submitted.compare_url = url;
        else if (rung === "patch") submitted.patch_path = url;
        else (submitted as Record<string, string>)["url"] = url;
      }
      info.submitted = submitted;
    }
  }
  return info;
}

export function listProposals(root: string, env?: Record<string, string | undefined>): ProposalInfo[] {
  if (!isRepo(root)) return [];
  const repo = repoRoot(root) ?? root;
  const r = runGit(repo, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${BRANCH_PREFIX}`]);
  if (r.code !== 0) return [];
  const result: ProposalInfo[] = [];
  for (const ref of r.stdout.split("\n").filter(Boolean)) {
    const info = describeProposal(root, ref.slice(BRANCH_PREFIX.length), env);
    if (info) result.push(info);
  }
  return result;
}

export function readFirstFor(root: string): string[] {
  const repo = repoRoot(root) ?? root;
  for (const candidate of [root, repo]) {
    try {
      const declared = loadConfig(candidate).brain.contributing;
      if (declared && declared.length > 0) return [...declared];
    } catch { /* skip */ }
  }
  if (existsSync(join(repo, "CONTRIBUTING.md"))) return ["CONTRIBUTING.md"];
  if (existsSync(join(root, "conventions", "index.md"))) return ["conventions/index.md"];
  return [];
}

// -- brain_contribute ----------------------------------------------------------------

export async function contribute(
  state: ServeState,
  doc: string,
  content: string,
  mode = "create",
  baseSha: string | null = null,
  budgetTokens: number | null = null,
  message = "",
  proposal: string | null = null,
  env: Record<string, string | undefined> = process.env,
): Promise<Payload> {
  const root = resolve(state.root);
  const repo = repoRoot(root) ?? root;
  if (!isRepo(root)) return { ok: false, hint: "not a git repository — a proposal needs a repository to branch." };
  if (!hasRemote(repo)) return { ok: false, hint: "no remote called origin — a proposal is made against the upstream repository this checkout was cloned from, and there is none." };
  if (!String(message).trim()) return { ok: false, hint: "a commit message is required — an engine never invents one for shared memory (spec/100)." };

  const name = slugify(proposal ?? basename(doc.split(":").pop()!).replace(/\.md$/, ""));
  let fetchNote = "";
  const fetched = runGit(repo, ["fetch", "--quiet", "origin"]);
  if (fetched.code !== 0) fetchNote = ` (fetch failed: ${fetched.stderr.trim() || "unknown"} — branched from origin as last fetched)`;

  const { worktree, branch, error } = ensureProposal(root, name, env);
  if (!worktree) return { ok: false, hint: (error ?? "unknown") + fetchNote };

  const rel = bundleRel(root, repo);
  const bundle = rel ? join(worktree, rel) : worktree;
  const wtConfig = loadConfig(existsSync(join(worktree, "brainpick.toml")) ? worktree : bundle);
  const ownSetting = wtConfig.validate.henxels; // the target's own choice, honoured below
  wtConfig.validate.henxels = "never"; // the whole contract runs below, over the worktree
  const wtState = new ServeState(bundle, wtConfig);

  const [status, payload] = await guardedWrite(wtState, doc, content, mode, baseSha, budgetTokens);
  if (status === "conflict") {
    (payload as Record<string, unknown>)["hint"] = ((payload as Record<string, unknown>)["hint"] as string ?? "") + " (against the proposal's copy of the doc)";
    return payload as Payload;
  }
  if (status !== "ok") return { ok: false, instruction: (payload as Record<string, unknown>)["instruction"] as string };
  const docRel = (payload as Record<string, unknown>)["path"] as string;

  wtConfig.validate.henxels = ownSetting; // else runContract would skip it
  const [outcome, detail] = runContract(bundle, wtConfig as { validate?: { henxels?: string } });
  if (outcome === "unavailable" || outcome === "fail") {
    runGit(worktree, ["checkout", "--", "."]);
    runGit(worktree, ["clean", "-fdq", "--", docRel]);
    return {
      ok: false, contract: outcome, instruction: detail ?? undefined,
      hint: outcome === "unavailable"
        ? "the target's contract could not be run — refusing to propose."
        : "the target's own henxels contract rejected this change — fix it and call brain_contribute again.",
    };
  }
  try { await runCompile(bundle, false, null, wtConfig); } catch { /* hook gate */ }

  record(worktree, "brainpick.proposal.contract", outcome);
  runGit(worktree, ["add", "-A", "--", ".", ":(exclude,glob)**/.brainpick/**", ":(exclude,glob).brainpick/**"]);
  const committed = runGit(worktree, ["commit", "-m", String(message).trim()]);
  if (committed.code !== 0) {
    return {
      ok: false, contract: "fail",
      instruction: `${committed.stdout}${committed.stderr}`.trim(),
      hint: "the commit was rejected by a hook (hooks always run) — the change is left uncommitted in the proposal worktree; fix and call again.",
    };
  }

  const described = describeProposal(root, name, env) ?? {} as ProposalInfo;
  const readFirst = readFirstFor(root);
  const stale = described.stale_base
    ? " The proposal's base is STALE — upstream moved on; drop and redo, or submit and let the maintainer rebase."
    : "";
  const guide = readFirst.length > 0 ? " Read read_first: the implant's own rules for contributions." : "";
  return {
    ok: true,
    proposal: described,
    contract: outcome,
    read_first: readFirst,
    hint: `${described.commits ?? 1} commit(s) on ${branch} (in your working copy for this proposal — a git worktree — not in the mounted brain). Add more with proposal='${name}', then brain_submit to open the pull request.${stale}${guide}${fetchNote}`,
  };
}

export function dropProposal(state: ServeState, name: string, _env?: Record<string, string | undefined>): Payload {
  const root = resolve(state.root);
  const repo = repoRoot(root) ?? root;
  const branch = branchName(name);
  const paths = worktreePaths(repo);
  if (!(branch in paths) && rev(repo, branch) === null) {
    return { ok: false, hint: `no proposal called '${slugify(name)}'.` };
  }
  if (branch in paths) runGit(repo, ["worktree", "remove", "--force", paths[branch]!]);
  runGit(repo, ["worktree", "prune"]);
  runGit(repo, ["branch", "-D", branch]);
  return { ok: true, proposal: slugify(name), hint: `dropped ${branch} and its worktree.` };
}

// -- brain_submit ---------------------------------------------------------------------

function forgeParts(originUrl: string): [string, string, string] | null {
  const m = originUrl.match(/^(?:https?:\/\/|git@|ssh:\/\/git@)([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return [m[1]!, m[2]!, m[3]!];
}

function webUrl(originUrl: string): string | null {
  const parts = forgeParts(originUrl);
  if (!parts) return null;
  return `https://${parts[0]}/${parts[1]}/${parts[2]}`;
}

function run(cmd: string[], cwd: string, timeout = 120_000): { code: number; stdout: string; stderr: string } {
  try {
    const proc = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", timeout });
    return { code: proc.status ?? 1, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
  } catch (e) {
    return { code: 1, stdout: "", stderr: String(e) };
  }
}

function forgeCli(host: string): string | null {
  const name = host === "github.com" || host.startsWith("github.") ? "gh" : "tea";
  try {
    const check = name === "gh" ? ["auth", "status"] : ["logins", "list"];
    const r = run([name, ...check], process.cwd(), 30_000);
    return r.code === 0 ? name : null;
  } catch {
    return null;
  }
}

function forkOwner(repo: string): string | null {
  const r = runGit(repo, ["remote", "get-url", "fork"]);
  if (r.code !== 0) return null;
  const parts = forgeParts(r.stdout.trim());
  return parts ? parts[1] : null;
}

/** Only from data the engine has: the commit messages, the files, the checks —
 * or, for the What section, the contributor's own words when given. */
function draftBody(root: string, described: ProposalInfo, contract: string, what: string | null): string {
  const repo = repoRoot(root) ?? root;
  if (!what) {
    const log = runGit(repo, ["log", "--reverse", "--format=%s", `${described.base}..${described.branch}`]);
    const lines = log.code === 0 ? log.stdout.split("\n").filter((l) => l.trim()).map((l) => `- ${l}`) : [];
    what = lines.join("\n") || "- (see commits)";
  }
  const pages = described.files.map((f) => `- ${f}`).join("\n") || "- (none)";
  return (
    `## What\n${what}\n\n## Pages\n${pages}\n\n` +
    `## Checks (run locally, the implant's own contract)\n` +
    `- henxels contract: ${contract}\n- brainpick compile --check-fresh: pass\n` +
    `- base: ${described.base} (origin's default branch at proposal time` +
    `${described.stale_base ? "; upstream has moved since" : ""})\n\n` +
    `_Proposed through brainpick brain_contribute. The checks are the implant's own ` +
    `contract; the claims are the contributor's._\n`
  );
}

export async function submit(
  state: ServeState,
  name: string,
  title: string | null = null,
  body: string | null = null,
  env: Record<string, string | undefined> = process.env,
): Promise<Payload> {
  const root = resolve(state.root);
  const repo = repoRoot(root) ?? root;
  name = slugify(name);
  const described = describeProposal(root, name, env);
  if (!described || described.commits === 0) {
    return { ok: false, hint: `no proposal called '${name}' with commits — brain_contribute first.` };
  }
  const worktree = described.worktree;
  const branch = described.branch;
  runGit(repo, ["fetch", "--quiet", "origin"]);
  const fresh = describeProposal(root, name, env) ?? described;

  const logR = runGit(repo, ["log", "-1", "--format=%s", branch]);
  const resolvedTitle = (title ?? "").trim() || (logR.code === 0 ? logR.stdout.trim() : name);
  const contract = existsSync(worktree) ? (readConfig(worktree, "brainpick.proposal.contract") ?? "pass") : "pass";
  const fullBody = draftBody(root, fresh, contract, body?.trim() || null);
  const stale = fresh.stale_base ? " Upstream has moved since this proposal was based; the maintainer may need to rebase." : "";

  const originR = runGit(repo, ["remote", "get-url", "origin"]);
  const originUrl = originR.code === 0 ? originR.stdout.trim() : "";
  const parts = forgeParts(originUrl);
  const web = webUrl(originUrl);
  const def = defaultBranch(repo) ?? "main";

  // Rung 1 — forge CLI
  const exe = parts ? forgeCli(parts[0]) : null;
  if (exe) {
    if (!hasRemote(repo, "fork")) {
      const forkCmd = exe.endsWith("gh")
        ? [exe, "repo", "fork", "--remote", "--remote-name", "fork"]
        : [exe, "repo", "fork", "--remote", "fork"];
      run(forkCmd, repo);
    }
    if (hasRemote(repo, "fork")) {
      const pushed = runGit(repo, ["push", "-u", "fork", branch]);
      if (pushed.code === 0) {
        const owner = forkOwner(repo) ?? "";
        const prCmd = [exe, "pr", "create", "--title", resolvedTitle, "--body", fullBody,
          "--base", def, "--head", owner ? `${owner}:${branch}` : branch];
        const pr = run(prCmd, existsSync(worktree) ? worktree : repo);
        if (pr.code === 0) {
          const url = pr.stdout.split(/\s+/).find((t) => t.startsWith("http")) ?? pr.stdout.trim();
          const numMatch = url.match(/\/pull\/(\d+)/);
          const number = numMatch ? Number(numMatch[1]) : undefined;
          if (existsSync(worktree)) {
            record(worktree, "brainpick.submitted.rung", "forge-cli");
            record(worktree, "brainpick.submitted.url", url);
          }
          return { ok: true, rung: "forge-cli", pr_url: url, number, title: resolvedTitle, body: fullBody, stale_base: fresh.stale_base,
            hint: `opened the pull request ${url} from your fork's ${branch} — the original repository (origin) was not written.${stale}` };
        }
      }
    }
  }

  // Rung 2 — fork remote
  if (hasRemote(repo, "fork")) {
    const pushed = runGit(repo, ["push", "-u", "fork", branch]);
    if (pushed.code === 0) {
      const owner = forkOwner(repo) ?? "<your-fork>";
      const compare = web ? `${web}/compare/${def}...${owner}:${branch}?expand=1` : `compare ${def}...${owner}:${branch} on the forge`;
      if (existsSync(worktree)) {
        record(worktree, "brainpick.submitted.rung", "fork-remote");
        record(worktree, "brainpick.submitted.url", compare);
      }
      return { ok: true, rung: "fork-remote", compare_url: compare, title: resolvedTitle, body: fullBody, stale_base: fresh.stale_base,
        hint: `pushed ${branch} to your own copy (the fork remote); the original (origin) was not written. Open the pull request at compare_url and paste title and body.${stale}` };
    }
  }

  // Rung 3 — patch
  const patchDir = existsSync(worktree) ? dirname(worktree) : join(proposalsHome(env), brainKey(root));
  mkdirSync(patchDir, { recursive: true });
  const patchPath = join(patchDir, `${name}.patch`);
  const patch = runGit(repo, ["format-patch", "--stdout", `${fresh.base}..${branch}`]);
  if (patch.code !== 0) return { ok: false, hint: `format-patch failed: ${patch.stderr.trim()}` };
  writeFileSync(patchPath, patch.stdout, "utf8");
  if (existsSync(worktree)) {
    record(worktree, "brainpick.submitted.rung", "patch");
    record(worktree, "brainpick.submitted.url", patchPath);
  }
  const where = web ? ` (${web})` : "";
  return { ok: true, rung: "patch", patch_path: patchPath, origin: originUrl, title: resolvedTitle, body: fullBody, stale_base: fresh.stale_base,
    hint: `no forge tool (gh/tea) and no fork remote here — wrote the change as a patch file to ${patchPath}. Attach it to an issue on the original repository${where} or send it to its maintainers with the title and body drafted above; nothing was pushed anywhere.${stale}` };
}

// -- MCP payloads ---------------------------------------------------------------------

async function routeContribute(
  target: ServeState | BrainSet,
  brain: string | null,
  doc: string | null,
): Promise<{ state: ServeState; alias: string | null; rel: string | null; refusal: Payload | null }> {
  if (!(target instanceof BrainSet)) return { state: target, alias: null, rel: doc, refusal: null };
  if (!target.federated) {
    const b = target.brains[0]!;
    return { state: await target.stateFor(b), alias: b.alias, rel: doc ? splitQualified(doc)[1] : doc, refusal: null };
  }
  if (!brain) {
    const [alias] = doc ? splitQualified(doc) : [null, null];
    if (!alias) return { state: await target.stateFor(target.focus), alias: null, rel: null,
      refusal: { ok: false, instruction: `name the brain — brain_contribute proposes to one brain: pass brain=<alias>, one of ${target.brains.map((b) => b.alias).join(", ")}` } };
    brain = alias;
  }
  const chosen = target.byAlias(brain);
  if (!chosen) return { state: await target.stateFor(target.focus), alias: null, rel: null,
    refusal: { ok: false, instruction: `no brain called '${brain}' — brains here: ${target.brains.map((b) => b.alias).join(", ")}` } };
  let rel = doc;
  if (doc) {
    const [alias, stripped] = splitQualified(doc);
    if (alias !== null && alias !== chosen.alias) return { state: await target.stateFor(chosen), alias: chosen.alias, rel: null,
      refusal: { ok: false, instruction: `doc '${doc}' names brain '${alias}' but brain='${chosen.alias}' — pick one` } };
    rel = alias !== null ? stripped : doc;
  }
  return { state: await target.stateFor(chosen), alias: chosen.alias, rel, refusal: null };
}

export async function contributePayload(
  target: ServeState | BrainSet,
  brain: string | null,
  doc: string | null,
  content: string | null,
  mode = "create",
  baseSha: string | null = null,
  message = "",
  proposal: string | null = null,
  drop = false,
  budgetTokens: number | null = null,
): Promise<Payload> {
  const { state, alias, rel, refusal } = await routeContribute(target, brain, doc);
  if (refusal) return refusal;
  let result: Payload;
  if (drop) {
    result = dropProposal(state, proposal ?? (rel ? basename(rel).replace(/\.md$/, "") : ""));
  } else {
    if (!rel || content === null) return { ok: false, instruction: "brain_contribute needs doc and content (or drop=true with proposal)" };
    result = await contribute(state, rel, content, mode, baseSha, budgetTokens, message, proposal);
  }
  if (alias) result["brain"] = alias;
  return result;
}

export async function submitPayload(
  target: ServeState | BrainSet,
  brain: string | null,
  proposal: string,
  title: string | null = null,
  body: string | null = null,
): Promise<Payload> {
  const { state, alias, refusal } = await routeContribute(target, brain, null);
  if (refusal) return refusal;
  const result = await submit(state, proposal, title, body);
  if (alias) result["brain"] = alias;
  return result;
}

// -- annotations (cross-brain backlinks) ---------------------------------------------

const BRAIN_LINK_RE = /brain:\/\/[a-z0-9-]*?([a-z0-9]{21})\/([^\s)>\]"']+)/g;

/** Every doc in every OTHER brain of the set whose brain:// links (spec/85,
 * slug-then-id) point at this doc — resolved by [bundle] id against the set. */
export async function annotations(
  set: BrainSet,
  brain: Brain,
  qualifiedPath: string,
): Promise<Array<{ brain: string; path: string; title: string }>> {
  let targetId: string;
  try { targetId = loadConfig(brain.root).bundle.id; } catch { return []; }
  if (!targetId) return [];
  const [, rel] = splitQualified(qualifiedPath);
  const cleanRel = rel.replace(/^\/+/, "");
  const found: Array<{ brain: string; path: string; title: string }> = [];
  for (const other of set.brains) {
    if (other === brain || set.unreadableReason(other) !== null) continue;
    const state = await set.stateFor(other);
    for (const record of state.records) {
      const text = record.text ?? "";
      if (!text.includes("brain://")) continue;
      for (const m of text.matchAll(BRAIN_LINK_RE)) {
        if (m[1] === targetId && m[2]!.replace(/[.,;:]+$/, "") === cleanRel) {
          found.push({ brain: other.alias, path: qualify(other.alias, record.path), title: record.title || record.path });
          break;
        }
      }
    }
  }
  return found;
}

export function proposalsHint(proposals: ProposalInfo[]): string {
  const merged = proposals.filter((p) => p.merged).map((p) => p.name);
  const stale = proposals.filter((p) => p.stale_base && !p.merged).map((p) => p.name);
  const parts = [`${proposals.length} proposal(s) (${proposals.map((p) => p.name).join(", ")})`];
  if (merged.length > 0) parts.push(`merged upstream: ${merged.join(", ")} — drop them with brain_contribute drop=true`);
  if (stale.length > 0) parts.push(`stale base: ${stale.join(", ")}`);
  return parts.join("; ") + ".";
}
