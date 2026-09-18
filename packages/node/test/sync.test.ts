/** Sync (spec/100): brain_status / brain_sync / brain_push — the git verbs.
 * The twin of packages/python/tests/test_sync.py.
 *
 * Every test drives REAL git in a temp repo: a wrong assumption about git's
 * behaviour is exactly the kind of bug a mocked test would hide. */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { loadConfig } from "../src/config";
import { runCompile } from "../src/compile/pipeline";
import * as detect from "../src/detect";
import { ServeState } from "../src/serve/state";
import {
  conflictedPaths,
  gitStatus,
  mergeStages,
  pushBrain,
  runGit,
  syncBrain,
} from "../src/sync";
import { cleanup, copyBundle, tempDir } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function git(root: string, ...args: string[]): string {
  const proc = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return proc.stdout ?? "";
}

function branchOf(root: string): string {
  return git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
}

/** A bundle in a git repo, with one commit. */
function makeRepo(): string {
  const root = copyBundle("kotiaurinko");
  git(root, "init", "-q", ".");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  return root;
}

/** [local, other] sharing an origin — two machines, one brain. */
function makePair(): [string, string] {
  const source = makeRepo();
  const base = tempDir();
  const origin = join(base, "origin.git");
  git(base, "clone", "-q", "--bare", source, origin);
  git(source, "remote", "add", "origin", origin);
  git(source, "fetch", "-q", "origin");
  git(source, "branch", "--set-upstream-to", `origin/${branchOf(source)}`, branchOf(source));

  const other = join(base, "other");
  git(base, "clone", "-q", origin, other);
  git(other, "config", "user.email", "o@example.com");
  git(other, "config", "user.name", "O");
  return [source, other];
}

function stateFor(root: string): ServeState {
  return new ServeState(root, loadConfig(root));
}

// -- git_status ---------------------------------------------------------------

describe("brain_status (spec/100)", () => {
  test("a clean checkout", () => {
    const [local] = makePair();
    const status = gitStatus(local);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
    expect(status.clean).toBe(true);
    expect(status.conflicts).toEqual([]);
    expect(status.upstream).not.toBeNull();
  });

  test("counts ahead and behind", () => {
    const [local, other] = makePair();
    writeFileSync(join(other, "theirs.md"), "---\ntype: Concept\n---\n\n# Theirs\n");
    git(other, "add", "-A");
    git(other, "commit", "-qm", "theirs");
    git(other, "push", "-q");

    writeFileSync(join(local, "ours.md"), "---\ntype: Concept\n---\n\n# Ours\n");
    git(local, "add", "-A");
    git(local, "commit", "-qm", "ours");

    // gitStatus never fetches (the caller decides whether to touch the network),
    // so `behind` only appears once the remote-tracking ref is up to date.
    expect(gitStatus(local).behind).toBe(0);
    runGit(local, ["fetch", "-q", "origin"]);
    const status = gitStatus(local);
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(1);
    expect(status.clean).toBe(false);
  });

  test("reports a dirty tree", () => {
    const [local] = makePair();
    writeFileSync(join(local, "kuu.md"), "dirty\n");
    writeFileSync(join(local, "untracked.md"), "new\n");
    const status = gitStatus(local);
    expect(status.dirty.modified).toBe(1);
    expect(status.dirty.untracked).toBe(1);
    expect(status.clean).toBe(false);
  });

  test("a bundle with no remote is valid, never an error", () => {
    const status = gitStatus(makeRepo());
    expect(status.upstream).toBeNull();
    expect(status.hint).toContain("no upstream");
  });

  test("a plain directory is reported, not thrown", () => {
    const plain = join(tempDir(), "plain");
    mkdirSync(plain);
    const status = gitStatus(plain);
    expect(status.repo).toBe(false);
    expect(status.hint).toContain("not a git repository");
  });
});

// -- merge stages -------------------------------------------------------------

describe("merge stages (spec/100)", () => {
  test("stages 1/2/3 carry base/ours/theirs", () => {
    const [local, other] = makePair();
    const doc = "kuu.md";
    const base = readFileSync(join(local, doc), "utf8");

    writeFileSync(join(other, doc), `${base}\nTHEIR line.\n`);
    git(other, "add", "-A");
    git(other, "commit", "-qm", "theirs");
    git(other, "push", "-q");

    writeFileSync(join(local, doc), `${base}\nOUR line.\n`);
    git(local, "add", "-A");
    git(local, "commit", "-qm", "ours");

    runGit(local, ["fetch", "-q", "origin"]);
    expect(runGit(local, ["merge", "--no-commit", "--no-ff", "@{u}"]).code).not.toBe(0);
    expect(conflictedPaths(local)).toEqual([doc]);

    const stages = mergeStages(local, doc);
    expect(stages.base).toBe(base);
    expect(stages.yours).toContain("OUR line.");
    expect(stages.yours).not.toContain("THEIR line.");
    expect(stages.theirs).toContain("THEIR line.");
  });

  test("a file added on both sides has no base", () => {
    const [local, other] = makePair();
    const doc = "both.md";
    writeFileSync(join(other, doc), "---\ntype: Concept\n---\n\n# Theirs\n");
    git(other, "add", "-A");
    git(other, "commit", "-qm", "theirs");
    git(other, "push", "-q");

    writeFileSync(join(local, doc), "---\ntype: Concept\n---\n\n# Ours\n");
    git(local, "add", "-A");
    git(local, "commit", "-qm", "ours");

    runGit(local, ["fetch", "-q", "origin"]);
    runGit(local, ["merge", "--no-commit", "--no-ff", "@{u}"]);
    const stages = mergeStages(local, doc);
    expect(stages.base).toBeNull();
    expect(stages.yours).toContain("Ours");
    expect(stages.theirs).toContain("Theirs");
  });
});

// -- brain_sync ---------------------------------------------------------------

describe("brain_sync (spec/100)", () => {
  test("nothing to do returns early", async () => {
    const [local] = makePair();
    const result = await syncBrain(stateFor(local));
    expect(result.ok).toBe(true);
    expect(result.behind_before).toBe(0);
    expect(result.committed).toBe(false);
  });

  test("fast-forwards a clean remote change", async () => {
    const [local, other] = makePair();
    writeFileSync(
      join(other, "uusi.md"),
      "---\ntype: Concept\ntitle: Uusi\ndescription: d\n---\n\n# Uusi\n\n[Kuu](kuu.md)\n",
    );
    git(other, "add", "-A");
    git(other, "commit", "-qm", "theirs");
    git(other, "push", "-q");

    const result = await syncBrain(stateFor(local));
    expect(result.ok).toBe(true);
    expect(result.behind_before).toBe(1);
    expect(result.unresolved).toEqual([]);
  });

  test("never commits its resolution", async () => {
    const [local, other] = makePair();
    const doc = "kuu.md";
    const base = readFileSync(join(local, doc), "utf8");
    writeFileSync(join(other, doc), `${base}\nTHEIRS.\n`);
    git(other, "add", "-A");
    git(other, "commit", "-qm", "t");
    git(other, "push", "-q");
    writeFileSync(join(local, doc), `OURS.\n${base}`);
    git(local, "add", "-A");
    git(local, "commit", "-qm", "o");

    const headBefore = git(local, "rev-parse", "HEAD").trim();
    const result = await syncBrain(stateFor(local));
    expect(result.committed).toBe(false);
    expect(git(local, "rev-parse", "HEAD").trim()).toBe(headBefore);
  });

  test("never writes conflict markers into a doc", async () => {
    const [local, other] = makePair();
    const doc = "kuu.md";
    writeFileSync(join(other, doc), "---\ntype: Concept\ntitle: Theirs\n---\n\n# Wholly theirs\n");
    git(other, "add", "-A");
    git(other, "commit", "-qm", "theirs");
    git(other, "push", "-q");

    writeFileSync(join(local, doc), "---\ntype: Concept\ntitle: Ours\n---\n\n# Wholly ours\n");
    git(local, "add", "-A");
    git(local, "commit", "-qm", "ours");

    const result = await syncBrain(stateFor(local)); // no chat model → no llm rung
    expect(result.unresolved.map((u) => u.path)).toEqual([doc]);
    const text = readFileSync(join(local, doc), "utf8");
    expect(text).not.toContain("<<<<<<<");
    expect(result.unresolved[0]!.theirs).toBeTruthy();
    expect(result.unresolved[0]!.yours).toBeTruthy();
  });

  test("reports when there is no upstream", async () => {
    const result = await syncBrain(stateFor(makeRepo()));
    expect(result.ok).toBe(false);
    expect(result.hint).toContain("no upstream");
  });
});

// -- brain_push ---------------------------------------------------------------

describe("brain_push (spec/100)", () => {
  test("publishes a bundle change", async () => {
    const [local, other] = makePair();
    writeFileSync(
      join(local, "uusi.md"),
      "---\ntype: Concept\ntitle: Uusi\ndescription: d\n---\n\n# Uusi\n\n[Kuu](kuu.md)\n",
    );
    const result = await pushBrain(stateFor(local), "add uusi");
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
    git(other, "pull", "-q");
    expect(readFileSync(join(other, "uusi.md"), "utf8")).toContain("Uusi");
  });

  test("refuses when behind — engines never pull on the agent's behalf", async () => {
    const [local, other] = makePair();
    writeFileSync(join(other, "theirs.md"), "---\ntype: Concept\n---\n\n# T\n");
    git(other, "add", "-A");
    git(other, "commit", "-qm", "t");
    git(other, "push", "-q");
    writeFileSync(join(local, "ours.md"), "---\ntype: Concept\n---\n\n# O\n");

    const result = await pushBrain(stateFor(local), "ours");
    expect(result.ok).toBe(false);
    expect(result.hint).toContain("behind");
    expect(result.hint).toContain("brain_sync");
  });

  test("refuses an empty message", async () => {
    const [local] = makePair();
    writeFileSync(join(local, "uusi.md"), "---\ntype: Concept\n---\n\n# U\n");
    const result = await pushBrain(stateFor(local), "   ");
    expect(result.ok).toBe(false);
    expect(result.hint).toContain("message");
  });

  test("refuses when nothing changed", async () => {
    // push compiles first, and a compile that rewrites the generated index.md IS a
    // real bundle change; publish that, then the second push has nothing to say.
    const [local] = makePair();
    expect((await pushBrain(stateFor(local), "compile artefacts")).ok).toBe(true);
    const result = await pushBrain(stateFor(local), "nothing to say");
    expect(result.ok).toBe(false);
    expect(result.hint).toContain("nothing");
  });

  test("refuses when the contract cannot be run", async () => {
    // The henxels hook warns and EXITS 0 when it cannot resolve the executable, so
    // the commit lands unenforced. An MCP server is the process most likely to have
    // that stripped PATH — "did not run" must never read as "passed".
    const [local] = makePair();
    writeFileSync(join(local, "henxels.yaml"), "henxels: []\n");
    writeFileSync(join(local, "uusi.md"), "---\ntype: Concept\n---\n\n# U\n");
    vi.spyOn(detect, "findHenxels").mockReturnValue(null);

    const result = await pushBrain(stateFor(local), "add uusi");
    expect(result.ok).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.contract).toBe("unavailable");
    expect(result.instruction).toContain("henxels");
  });

  test("no contract is not a skipped contract", async () => {
    const [local] = makePair();
    writeFileSync(join(local, "uusi.md"), "---\ntype: Concept\n---\n\n# U\n");
    vi.spyOn(detect, "findHenxels").mockReturnValue(null);

    const result = await pushBrain(stateFor(local), "add uusi");
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(true);
  });
});

// -- brain_contract -----------------------------------------------------------

describe("brain_contract (spec/100)", () => {
  test("announces every requirement", async () => {
    const { contractPayload } = await import("../src/mcp");
    const root = makeRepo();
    await runCompile(root, false, null, loadConfig(root));
    const payload = await contractPayload(stateFor(root));

    expect((payload.requirements as { id: string }[]).map((r) => r.id)).toEqual([
      "bundle-root",
      "manifest",
      "artifacts",
      "fresh",
      "frontmatter",
      "brain-format",
    ]);
    for (const req of payload.requirements as Record<string, unknown>[]) {
      expect(Object.keys(req)).toEqual(expect.arrayContaining(["id", "required", "satisfied", "what", "why"]));
    }
    expect(payload.satisfied).toBe(true);
  });

  test("reports a missing manifest with its fix", async () => {
    const { contractPayload } = await import("../src/mcp");
    const payload = await contractPayload(stateFor(makeRepo()), false);
    const manifest = (payload.requirements as Record<string, unknown>[]).find((r) => r.id === "manifest")!;
    expect(manifest.required).toBe(true);
    expect(manifest.satisfied).toBe(false);
    expect(String(manifest.fix)).toContain("brainpick compile");
    expect(payload.satisfied).toBe(false);
  });

  test("reports a corrupt manifest", async () => {
    const { contractPayload } = await import("../src/mcp");
    const root = makeRepo();
    await runCompile(root, false, null, loadConfig(root));
    writeFileSync(join(root, ".brainpick", "manifest.json"), "{not json");
    const payload = await contractPayload(stateFor(root), false);
    const manifest = (payload.requirements as Record<string, unknown>[]).find((r) => r.id === "manifest")!;
    expect(manifest.satisfied).toBe(false);
    expect(String(manifest.detail)).toContain("JSON");
  });

  test("never reports a project's layout as a defect", async () => {
    const { contractPayload } = await import("../src/mcp");
    const root = makeRepo();
    mkdirSync(join(root, "WeirdFolder"));
    writeFileSync(
      join(root, "WeirdFolder", "Weird_Name.md"),
      "---\ntype: Concept\ntitle: W\ndescription: d\n---\n\n# W\n",
    );
    await runCompile(root, false, null, loadConfig(root));
    const payload = await contractPayload(stateFor(root), false);
    expect(payload.satisfied).toBe(true);
  });
});

export { cpSync, rmSync };
