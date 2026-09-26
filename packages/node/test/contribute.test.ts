/** Read-only implants and the contribution flow (spec/105) — the twin of
 * packages/python/tests/test_contribute.py, test_contribute_access.py and
 * test_contribute_sync.py.
 *
 * Real git and a local bare "origin" throughout; the forge rung uses a fake `gh`,
 * the contract gate a fake `henxels`. */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadConfig } from "../src/config";
import { contribute, contributePayload, dropProposal, listProposals, proposalDir, submit, submitPayload } from "../src/contribute";
import { Brain, BrainSet, loadRegistry, READ_ONLY, READ_WRITE, registerBrain, runRegister } from "../src/federation";
import { createMcpServer, overviewPayload, readPayload, writePayload } from "../src/mcp";
import { ServeState } from "../src/serve/state";
import { gitStatus, pushBrain, syncBrain } from "../src/sync";
import { cleanup, FIXTURE_BUNDLES, tempDir } from "./helpers";

const DOC = "---\ntype: Concept\ntitle: Uusi\ndescription: d\n---\n\n# Uusi\n\n[Kuu](kuu.md)\n";
const FIX = "---\ntype: Concept\ntitle: Kuu\ndescription: fixed\n---\n\n# Kuu\n\nCorrected. [Maa](maa.md)\n";
const ID = "abcdefghijklmnopqrstu";
const HAS_GIT = spawnSync("git", ["--version"]).status === 0;

let savedEnv: NodeJS.ProcessEnv;
let home: string;

beforeEach(() => {
  savedEnv = { ...process.env };
  home = join(tempDir(), "proposals");
  process.env["BRAINPICK_PROPOSALS"] = home;
});

afterEach(() => {
  process.env = savedEnv;
  cleanup();
});

function git(root: string, ...args: string[]): string {
  const proc = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (proc.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr}`);
  return proc.stdout;
}

function gitMaybe(root: string, ...args: string[]): string {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).stdout ?? "";
}

function branchOf(root: string): string {
  return git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
}

function identity(root: string, name: string): void {
  git(root, "config", "user.email", `${name}@example.com`);
  git(root, "config", "user.name", name);
}

/** An implant cloned from a bare origin the agent does not own. */
function makeMirror(): { base: string; mirror: string; origin: string; other: string } {
  const base = tempDir();
  const seed = join(base, "seed");
  cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), seed, { recursive: true });
  writeFileSync(join(seed, "brainpick.toml"), `[bundle]\nid = "${ID}"\n[brain]\nformat = 3\n`, "utf8");
  git(base, "init", "-q", seed);
  identity(seed, "t");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "seed");
  const origin = join(base, "origin.git");
  git(base, "clone", "-q", "--bare", seed, origin);
  const mirror = join(base, "mirror");
  git(base, "clone", "-q", origin, mirror);
  identity(mirror, "agent");
  const other = join(base, "other");
  git(base, "clone", "-q", origin, other);
  identity(other, "o");
  return { base, mirror, origin, other };
}

function stateFor(root: string): ServeState {
  return new ServeState(root, loadConfig(root));
}

function snapshot(root: string): [string, string] {
  return [git(root, "rev-parse", "HEAD"), git(root, "status", "--porcelain")];
}

function commitUpstream(other: string, name = "theirs.md"): void {
  writeFileSync(join(other, name), DOC, "utf8");
  git(other, "add", "-A");
  git(other, "commit", "-qm", "theirs");
  git(other, "push", "-q");
}

/** A PATH with git and nothing else — no gh, no tea. */
function noForge(base: string): void {
  const bin = join(base, "onlygit");
  mkdirSync(bin);
  const gitPath = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  symlinkSync(gitPath, join(bin, "git"));
  process.env["PATH"] = bin;
}

function fakeTool(base: string, name: string, script: string): void {
  const bin = join(base, `fake-${name}`);
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, name);
  writeFileSync(exe, `#!/bin/sh\n${script}`, "utf8");
  chmodSync(exe, 0o755);
  process.env["PATH"] = `${bin}${delimiter}${process.env["PATH"]}`;
}

describe.skipIf(!HAS_GIT)("brain_contribute", () => {
  test("commits on a worktree branch and never touches the mirror", async () => {
    const { mirror } = makeMirror();
    const before = snapshot(mirror);
    const result = await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add uusi kivi");
    expect(result["ok"], JSON.stringify(result)).toBe(true);
    const p = result["proposal"] as Record<string, unknown>;
    expect(p["name"]).toBe("uusi-kivi");
    expect(p["branch"]).toBe("contrib/uusi-kivi");
    expect(p["commits"]).toBe(1);
    expect(p["stale_base"]).toBe(false);
    const files = p["files"] as string[];
    expect(files).toContain("uusi-kivi.md");
    expect(files.some((f) => f.includes(".brainpick"))).toBe(false);
    expect(p["worktree"]).toBe(proposalDir(mirror, "uusi-kivi"));
    expect(existsSync(join(home, ID, "uusi-kivi", "uusi-kivi.md"))).toBe(true);
    expect(snapshot(mirror)).toEqual(before);
    expect(existsSync(join(mirror, "uusi-kivi.md"))).toBe(false);
    expect(git(mirror, "log", "--oneline", "origin/HEAD..contrib/uusi-kivi").trim().split("\n")).toHaveLength(1);
    expect(result["hint"]).toContain("brain_submit");
  });

  test("branches from the newest upstream, not the local checkout", async () => {
    const { mirror, other } = makeMirror();
    commitUpstream(other);
    const result = await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    expect(result["ok"]).toBe(true);
    expect(existsSync(join(home, ID, "uusi-kivi", "theirs.md"))).toBe(true);
    expect(git(mirror, "status", "--porcelain").trim()).toBe("");
  });

  test("several contributions accumulate on one proposal", async () => {
    const { mirror } = makeMirror();
    const first = await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    const second = await contribute(stateFor(mirror), "kuu", FIX, "replace", null, null, "fix kuu", "uusi-kivi");
    expect(second["ok"]).toBe(true);
    const p = second["proposal"] as Record<string, unknown>;
    expect(p["commits"]).toBe(2);
    expect(p["files"]).toEqual(expect.arrayContaining(["kuu.md", "uusi-kivi.md"]));
    expect((first["proposal"] as Record<string, unknown>)["worktree"]).toBe(p["worktree"]);
  });

  test("runs the guarded ladder in the worktree", async () => {
    const { mirror } = makeMirror();
    const exists = await contribute(stateFor(mirror), "kuu", FIX, "create", null, null, "x");
    expect(exists["ok"]).toBe(false);
    expect(String(exists["instruction"])).toContain("already exists");
    const stale = await contribute(stateFor(mirror), "kuu", FIX, "replace", "0".repeat(64), null, "x");
    expect(stale["ok"]).toBe(false);
    expect(stale["conflict"]).toBe(true);
    expect(git(mirror, "status", "--porcelain").trim()).toBe("");
  });

  test("reports a stale base and never rebases", async () => {
    const { mirror, other } = makeMirror();
    await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    commitUpstream(other);
    const result = await contribute(stateFor(mirror), "toinen", DOC, "create", null, null, "more", "uusi-kivi");
    expect(result["ok"]).toBe(true);
    const p = result["proposal"] as Record<string, unknown>;
    expect(p["stale_base"]).toBe(true);
    expect(String(result["hint"]).toLowerCase()).toContain("stale");
    expect(p["commits"]).toBe(2);
  });

  test("requires a message and a remote", async () => {
    const { base, mirror } = makeMirror();
    expect((await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "  "))["ok"]).toBe(false);
    const lone = join(base, "lone");
    cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), lone, { recursive: true });
    git(base, "init", "-q", lone);
    const result = await contribute(stateFor(lone), "uusi-kivi", DOC, "create", null, null, "add");
    expect(result["ok"]).toBe(false);
    expect(String(result["hint"])).toContain("remote");
  });

  test("the target's contract gates the proposal", async () => {
    const { base, mirror } = makeMirror();
    writeFileSync(join(mirror, "henxels.yaml"), "henxels: []\n", "utf8");
    git(mirror, "add", "-A");
    git(mirror, "commit", "-qm", "contract");
    git(mirror, "push", "-q");
    fakeTool(base, "henxels", "echo contract says no >&2\nexit 1\n");
    const result = await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    expect(result["ok"]).toBe(false);
    expect(result["contract"]).toBe("fail");
    expect(String(result["instruction"])).toContain("contract says no");
    expect(gitMaybe(mirror, "log", "--oneline", "origin/HEAD..contrib/uusi-kivi").trim()).toBe("");
    expect(existsSync(join(proposalDir(mirror, "uusi-kivi"), "uusi-kivi.md"))).toBe(false);
  });

  test("a passing contract is recorded", async () => {
    const { base, mirror } = makeMirror();
    writeFileSync(join(mirror, "henxels.yaml"), "henxels: []\n", "utf8");
    git(mirror, "add", "-A");
    git(mirror, "commit", "-qm", "contract");
    git(mirror, "push", "-q");
    fakeTool(base, "henxels", "exit 0\n");
    const result = await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    expect(result["ok"]).toBe(true);
    expect(result["contract"]).toBe("pass");
  });

  test("first contact is apply and brief", async () => {
    const { mirror } = makeMirror();
    writeFileSync(join(mirror, "CONTRIBUTING.md"), "# How\n", "utf8");
    git(mirror, "add", "-A");
    git(mirror, "commit", "-qm", "guide");
    git(mirror, "push", "-q");
    const result = await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    expect(result["ok"]).toBe(true);
    expect(result["read_first"]).toEqual(["CONTRIBUTING.md"]);
    expect(String(result["hint"])).toContain("read_first");
  });

  test("read_first prefers the declared guide", async () => {
    const { mirror } = makeMirror();
    writeFileSync(
      join(mirror, "brainpick.toml"),
      `[bundle]\nid = "${ID}"\n[brain]\nformat = 3\ncontributing = ["kuu.md", "maa.md"]\n`,
      "utf8",
    );
    git(mirror, "add", "-A");
    git(mirror, "commit", "-qm", "guide");
    git(mirror, "push", "-q");
    const result = await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    expect(result["read_first"]).toEqual(["kuu.md", "maa.md"]);
  });

  test("drop removes the worktree and branch", async () => {
    const { mirror } = makeMirror();
    await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    expect(dropProposal(stateFor(mirror), "uusi-kivi")["ok"]).toBe(true);
    expect(existsSync(proposalDir(mirror, "uusi-kivi"))).toBe(false);
    expect(gitMaybe(mirror, "rev-parse", "--verify", "--quiet", "contrib/uusi-kivi")).toBe("");
    expect(dropProposal(stateFor(mirror), "uusi-kivi")["ok"]).toBe(false);
  });
});

describe.skipIf(!HAS_GIT)("brain_submit", () => {
  test("patch rung yields a patch that applies to origin", async () => {
    const { base, mirror, origin, other } = makeMirror();
    await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add uusi kivi");
    noForge(base);
    const result = await submit(stateFor(mirror), "uusi-kivi");
    expect(result["ok"]).toBe(true);
    expect(result["rung"]).toBe("patch");
    expect(result["title"]).toBe("add uusi kivi");
    expect(String(result["body"])).toContain("## Checks");
    expect(String(result["body"])).toContain("henxels contract");
    expect(String(result["body"])).toContain("add uusi kivi");
    const patch = String(result["patch_path"]);
    expect(existsSync(patch)).toBe(true);
    git(other, "am", patch);
    expect(existsSync(join(other, "uusi-kivi.md"))).toBe(true);
    expect(git(origin, "branch", "--list", "contrib/*").trim()).toBe("");
  });

  test("fork rung pushes to fork, never origin", async () => {
    const { base, mirror, origin } = makeMirror();
    const fork = join(base, "fork.git");
    git(base, "clone", "-q", "--bare", origin, fork);
    git(mirror, "remote", "add", "fork", fork);
    await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add uusi kivi");
    noForge(base);
    const result = await submit(stateFor(mirror), "uusi-kivi");
    expect(result["ok"]).toBe(true);
    expect(result["rung"]).toBe("fork-remote");
    expect(git(fork, "branch", "--list", "contrib/*").trim().endsWith("contrib/uusi-kivi")).toBe(true);
    expect(git(origin, "branch", "--list", "contrib/*").trim()).toBe("");
    expect(result["compare_url"]).toBeTruthy();
    const listed = Object.fromEntries(listProposals(mirror).map((p) => [p.name, p]));
    expect(listed["uusi-kivi"]!.submitted?.rung).toBe("fork-remote");
  });

  test("forge rung uses gh", async () => {
    const { base, mirror, origin } = makeMirror();
    const fork = join(base, "fork.git");
    git(base, "clone", "-q", "--bare", origin, fork);
    await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add uusi kivi");
    git(mirror, "remote", "set-url", "origin", "https://github.com/someone/implant.git");
    const log = join(base, "gh.log");
    fakeTool(
      base,
      "gh",
      `echo "$@" >> ${log}\n` +
        `case "$1 $2" in\n` +
        `  'auth status') exit 0;;\n` +
        `  'repo fork') git remote add fork ${fork}; exit 0;;\n` +
        `  'pr create') echo https://github.com/someone/implant/pull/12; exit 0;;\n` +
        `esac\nexit 1\n`,
    );
    const result = await submit(stateFor(mirror), "uusi-kivi", "Fix", "Because.");
    expect(result["ok"], JSON.stringify(result)).toBe(true);
    expect(result["rung"]).toBe("forge-cli");
    expect(result["pr_url"]).toBe("https://github.com/someone/implant/pull/12");
    expect(result["number"]).toBe(12);
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("pr create");
    expect(calls).toContain("--title Fix");
    expect(String(result["body"])).toContain("Because.");
    expect(String(result["body"])).toContain("## Checks");
    expect(git(fork, "branch", "--list", "contrib/*").trim().endsWith("contrib/uusi-kivi")).toBe(true);
    expect(git(origin, "branch", "--list", "contrib/*").trim()).toBe("");
  });

  test("refuses an unknown proposal", async () => {
    const { mirror } = makeMirror();
    const result = await submit(stateFor(mirror), "nothing");
    expect(result["ok"]).toBe(false);
    expect(String(result["hint"])).toContain("no proposal");
  });
});

describe.skipIf(!HAS_GIT)("proposal lifecycle", () => {
  test("status lists proposals and detects merged", async () => {
    const { mirror, other } = makeMirror();
    await contribute(stateFor(mirror), "uusi-kivi", DOC, "create", null, null, "add");
    let status = gitStatus(mirror);
    expect(status.proposals?.map((p) => p.name)).toEqual(["uusi-kivi"]);
    expect(status.proposals?.[0]?.merged).toBe(false);
    git(other, "fetch", "-q", mirror, "contrib/uusi-kivi:contrib/uusi-kivi");
    git(other, "merge", "-q", "--ff-only", "contrib/uusi-kivi");
    git(other, "push", "-q");
    status = gitStatus(mirror);
    expect(status.proposals?.[0]?.merged).toBe(true);
    expect(status.hint).toContain("merged");
    expect(status.hint).toContain("drop");
  });

  test("status without proposals carries no key", () => {
    const { mirror } = makeMirror();
    expect("proposals" in gitStatus(mirror)).toBe(false);
  });

  test("payloads route by alias and strip it from doc", async () => {
    const { base, mirror } = makeMirror();
    const kirja = join(base, "kirja");
    cpSync(join(FIXTURE_BUNDLES, "kotikirja"), kirja, { recursive: true });
    const set = new BrainSet([
      new Brain({ alias: "aurinko", root: mirror, role: "implant", access: READ_ONLY }),
      new Brain({ alias: "kirja", root: kirja, role: "cortex" }),
    ]);
    const result = await contributePayload(set, "aurinko", "aurinko:uusi-kivi", DOC, "create", null, "add");
    expect(result["ok"], JSON.stringify(result)).toBe(true);
    expect(result["brain"]).toBe("aurinko");
    expect((result["proposal"] as Record<string, unknown>)["files"]).toContain("uusi-kivi.md");
    const missing = await contributePayload(set, null, "uusi-kivi", DOC, "create", null, "add");
    expect(missing["ok"]).toBe(false);
    expect(String(missing["instruction"])).toContain("brain");
    noForge(base);
    const submitted = await submitPayload(set, "aurinko", "uusi-kivi");
    expect(submitted["ok"]).toBe(true);
    expect(submitted["brain"]).toBe("aurinko");
    expect(submitted["rung"]).toBe("patch");
  });
});

// -- read-only mounts on the spec/100 verbs ------------------------------------------

/** [local, other] sharing a bare origin. */
function makePair(): { base: string; local: string; other: string } {
  const base = tempDir();
  const source = join(base, "source");
  cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), source, { recursive: true });
  git(base, "init", "-q", source);
  identity(source, "t");
  git(source, "add", "-A");
  git(source, "commit", "-qm", "seed");
  const origin = join(base, "origin.git");
  git(base, "clone", "-q", "--bare", source, origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "fetch", "-q", "origin");
  git(source, "branch", "--set-upstream-to", `origin/${branchOf(source)}`, branchOf(source));
  const other = join(base, "other");
  git(base, "clone", "-q", origin, other);
  identity(other, "o");
  return { base, local: source, other };
}

describe.skipIf(!HAS_GIT)("read-only sync and push", () => {
  test("push on a read-only mount refuses with the redirect", async () => {
    const { local } = makePair();
    writeFileSync(join(local, "uusi.md"), DOC, "utf8");
    const result = await pushBrain(stateFor(local), "add uusi", READ_ONLY);
    expect(result.ok).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.access).toBe(READ_ONLY);
    expect(result.hint).toContain("brain_contribute");
    expect(git(local, "status", "--porcelain").trim()).toBe("?? uusi.md");
  });

  test("sync on a read-only mount fast-forwards", async () => {
    const { local, other } = makePair();
    commitUpstream(other);
    const result = await syncBrain(stateFor(local), null, READ_ONLY);
    expect(result.ok).toBe(true);
    expect(result.behind_before).toBe(1);
    expect(existsSync(join(local, "theirs.md"))).toBe(true);
    expect(result.merged).toEqual([]);
    expect(result.diverged).toBe(false);
  });

  test("sync on a read-only mount never merges a diverged checkout", async () => {
    const { local, other } = makePair();
    commitUpstream(other);
    writeFileSync(join(local, "ours.md"), DOC, "utf8");
    git(local, "add", "-A");
    git(local, "commit", "-qm", "ours");
    const result = await syncBrain(stateFor(local), null, READ_ONLY);
    expect(result.ok).toBe(false);
    expect(result.diverged).toBe(true);
    expect(result.merged).toEqual([]);
    expect(result.hint).toContain("diverged");
    expect(git(local, "log", "--oneline").trim().split("\n")).toHaveLength(2);
    expect(existsSync(join(local, "theirs.md"))).toBe(false);
  });

  test("push denied by the remote teaches read-only", async () => {
    const { base, local } = makePair();
    writeFileSync(join(local, "uusi.md"), DOC, "utf8");
    const hook = join(base, "origin.git", "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho 'remote: permission denied' >&2\nexit 1\n", "utf8");
    chmodSync(hook, 0o755);
    const result = await pushBrain(stateFor(local), "add uusi");
    expect(result.ok).toBe(false);
    expect(result.hint).toContain("--read-only");
    expect(result.hint).toContain("brain_contribute");
  });
});

// -- the registry and the tool surface ----------------------------------------------

const NEW_DOC =
  "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n# Uusi kivi\n\nNear [Kuu](kuu.md).\n";

function makeSet(access = READ_ONLY): BrainSet {
  const base = tempDir();
  const a = join(base, "kotiaurinko");
  const k = join(base, "kotikirja");
  cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), a, { recursive: true });
  cpSync(join(FIXTURE_BUNDLES, "kotikirja"), k, { recursive: true });
  writeFileSync(join(a, "brainpick.toml"), `[bundle]\nid = "${ID}"\n`, "utf8");
  return new BrainSet([
    new Brain({ alias: "aurinko", root: a, role: "implant", access }),
    new Brain({ alias: "kirja", root: k, role: "cortex" }),
  ]);
}

describe("read-only access", () => {
  test("register --read-only round-trips after role", () => {
    const base = tempDir();
    const registry = join(base, "brains.toml");
    const root = join(base, "kotiaurinko");
    cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), root, { recursive: true });
    const entry = registerBrain(root, registry, { alias: "a", role: "implant", access: READ_ONLY });
    expect(entry.access).toBe(READ_ONLY);
    const text = readFileSync(registry, "utf8");
    expect(text.indexOf('role = "implant"')).toBeLessThan(text.indexOf('access = "read-only"'));
    expect(loadRegistry(registry)[0]!.access).toBe(READ_ONLY);
    registerBrain(root, registry, { access: READ_WRITE });
    expect("access" in loadRegistry(registry)[0]!).toBe(false);
  });

  test("absent or unknown access reads as read-write", () => {
    const root = join(tempDir(), "x");
    cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), root, { recursive: true });
    expect(new Brain({ alias: "b", root }).access).toBe(READ_WRITE);
    expect(new Brain({ alias: "b", root, access: "banana" }).access).toBe(READ_WRITE);
  });

  test("write to a read-only implant refuses with a redirect", async () => {
    const set = makeSet();
    const result = await writePayload(set, "aurinko:uusi-kivi", NEW_DOC);
    expect(result["ok"]).toBe(false);
    expect(result["brain"]).toBe("aurinko");
    expect(result["access"]).toBe(READ_ONLY);
    expect(result["brain_link"]).toBe(`brain://aurinko-${ID}/uusi-kivi.md`);
    expect(String(result["instruction"])).toContain("brain_write 'kirja:");
    expect(String(result["instruction"])).toContain("brain_contribute");
    expect(existsSync(join(set.byAlias("aurinko")!.root, "uusi-kivi.md"))).toBe(false);
  });

  test("brain_link is null without a bundle id", async () => {
    const set = makeSet();
    unlinkSync(join(set.byAlias("aurinko")!.root, "brainpick.toml"));
    const result = await writePayload(set, "aurinko:uusi-kivi", NEW_DOC);
    expect(result["ok"]).toBe(false);
    expect(result["brain_link"]).toBeNull();
  });

  test("a read-write implant still writes", async () => {
    const result = await writePayload(makeSet(READ_WRITE), "aurinko:uusi-kivi", NEW_DOC);
    expect(result["ok"]).toBe(true);
  });

  test("overview lists access and hints the redirect", async () => {
    const result = await overviewPayload(makeSet());
    const listing = Object.fromEntries((result["brains"] as Array<Record<string, unknown>>).map((b) => [b["alias"], b]));
    expect(listing["aurinko"]!["access"]).toBe(READ_ONLY);
    expect(listing["kirja"]!["access"]).toBe(READ_WRITE);
    expect(String(result["hint"])).toContain("read-only");
    expect(String(result["hint"])).toContain("brain_contribute");
    const uniform = await overviewPayload(makeSet(READ_WRITE));
    expect(String(uniform["hint"])).not.toContain("read-only");
  });

  test("read surfaces annotations from other brains", async () => {
    const set = makeSet();
    writeFileSync(
      join(set.byAlias("kirja")!.root, "kuu-note.md"),
      "---\ntype: Concept\ntitle: Kuu, corrected\ndescription: My note on the implant's kuu page.\n---\n\n" +
        `# Kuu, corrected\n\nThe implant's page brain://aurinko-${ID}/kuu.md cites the wrong figure. See [Kahvi](kahvi.md).\n`,
      "utf8",
    );
    const result = await readPayload(set, "aurinko:kuu.md");
    expect(result["annotations"]).toEqual([{ brain: "kirja", path: "kirja:kuu-note.md", title: "Kuu, corrected" }]);
    expect(String(result["hint"])).toContain("annotations");
    expect("annotations" in (await readPayload(set, "aurinko:maa.md"))).toBe(false);
    expect("annotations" in (await readPayload(set, "kirja:kuu-note.md"))).toBe(false);
  });

  test("cli register --read-only marks the entry", () => {
    const base = tempDir();
    const registry = join(base, "brains.toml");
    const root = join(base, "kotiaurinko");
    cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), root, { recursive: true });
    const out: string[] = [];
    const print = (line: string) => out.push(line);
    expect(runRegister(root, { registryPath: registry, alias: "a", role: "implant", access: READ_ONLY, print })).toBe(0);
    expect(out.join("\n")).toContain("(read-only)");
    out.length = 0;
    expect(runRegister(null, { registryPath: registry, print })).toBe(0);
    expect(out.join("\n")).toContain("(read-only)");
    expect(runRegister(root, { registryPath: registry, access: READ_WRITE, print })).toBe(0);
    expect("access" in loadRegistry(registry)[0]!).toBe(false);
  });
});

describe("the serve.git ladder", () => {
  test("contribute sits between sync and push", () => {
    const root = join(tempDir(), "b");
    cpSync(join(FIXTURE_BUNDLES, "kotiaurinko"), root, { recursive: true });
    const names = (level: string): Set<string> => {
      const config = loadConfig(root);
      config.serve.git = level;
      const server = createMcpServer(new ServeState(root, config));
      return new Set(Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools));
    };
    const sync = names("sync");
    expect(sync.has("brain_sync")).toBe(true);
    for (const t of ["brain_contribute", "brain_submit", "brain_push"]) expect(sync.has(t)).toBe(false);
    const contrib = names("contribute");
    for (const t of ["brain_status", "brain_sync", "brain_contribute", "brain_submit"]) expect(contrib.has(t)).toBe(true);
    expect(contrib.has("brain_push")).toBe(false);
    const push = names("push");
    for (const t of ["brain_status", "brain_sync", "brain_contribute", "brain_submit", "brain_push"]) expect(push.has(t)).toBe(true);
  });
});
