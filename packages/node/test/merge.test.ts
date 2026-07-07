/** The merge resolution ladder (spec/70 brain_write): mechanical three-way when
 * edits do not overlap, the [models.extraction] model when they do, null (manual)
 * when neither is available. Overlap detection is conservative: in doubt, null.
 * Twin of packages/python/tests/test_merge.py. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { sha256Hex } from "../src/core/canonical";
import { ChatUnavailable, MockChat, type ChatClient } from "../src/llm";
import {
  findBase,
  gitBase,
  llmMerge,
  llmMergeTwo,
  MERGE_SYSTEM,
  MERGE_SYSTEM_TWO,
  resolve,
  threeWay,
} from "../src/merge";
import { cleanup, tempDir } from "./helpers";

afterEach(cleanup);

const BASE = `---
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
`;

const THEIRS = BASE.replaceAll("The moon pulls the tides.", "The moon pulls the tides of every sea.");
const YOURS = BASE.replaceAll("New moon, then full moon.", "New moon, waxing crescent, then full moon.");

function goodMerge(): string {
  return THEIRS.replaceAll("New moon, then full moon.", "New moon, waxing crescent, then full moon.");
}

// -- three_way -----------------------------------------------------------------------

test("three-way merges non-overlapping edits", () => {
  const merged = threeWay(BASE, THEIRS, YOURS);
  expect(merged).not.toBeNull();
  expect(merged!).toContain("tides of every sea"); // their edit survives
  expect(merged!).toContain("waxing crescent"); // your edit survives
  expect(merged!).toContain("The end."); // untouched regions intact
  expect(merged!.startsWith("---\n")).toBe(true); // frontmatter intact
});

test("three-way merges an appended section", () => {
  const appended = BASE + "\n## Uusi\n\nAppended at the end.\n";
  const merged = threeWay(BASE, appended, YOURS);
  expect(merged).not.toBeNull();
  expect(merged!).toContain("Appended at the end.");
  expect(merged!).toContain("waxing crescent");
});

test("three-way trivial cases", () => {
  expect(threeWay(BASE, BASE, YOURS)).toBe(YOURS); // they did nothing — yours wins
  expect(threeWay(BASE, THEIRS, BASE)).toBe(THEIRS); // you did nothing — theirs wins
  expect(threeWay(BASE, THEIRS, THEIRS)).toBe(THEIRS); // identical edits agree
});

test("three-way overlapping edits return null", () => {
  const theirs = BASE.replaceAll("The moon pulls the tides.", "Their version of the line.");
  const yours = BASE.replaceAll("The moon pulls the tides.", "Your version of the line.");
  expect(threeWay(BASE, theirs, yours)).toBeNull();
});

test("three-way adjacent edits are conservatively null", () => {
  // Edits with no stable line between them collapse into one region → conflict.
  const theirs = BASE.replaceAll("## Vaiheet", "## Vaiheet ja muodot");
  const yours = BASE.replaceAll(
    "## Vaiheet\n\nNew moon, then full moon.",
    "## Vaiheet\n\nNew moon, then full moon, then new again.",
  );
  expect(threeWay(BASE, theirs, yours)).toBeNull();
});

test("three-way handles missing trailing newline", () => {
  const base = "one\ntwo\nthree";
  const merged = threeWay(base, "one!\ntwo\nthree", "one\ntwo\nthree!");
  expect(merged).toBe("one!\ntwo\nthree!");
});

// -- llm_merge -----------------------------------------------------------------------

test("llm merge returns a sane reply and prompts with all three", async () => {
  const chat = new MockChat(goodMerge());
  const merged = await llmMerge(BASE, THEIRS, YOURS, chat);
  expect(merged).toBe(goodMerge());
  expect(chat.calls.length).toBe(1);
  const [system, user] = chat.calls[0]!;
  expect(system).toBe(MERGE_SYSTEM);
  expect(user).toContain("BASE");
  expect(user).toContain("THEIRS");
  expect(user).toContain("YOURS");
  expect(user).toContain("tides of every sea");
  expect(user).toContain("waxing crescent");
});

test("llm merge unwraps a code fence", async () => {
  const chat = new MockChat("```markdown\n" + goodMerge() + "```\n");
  expect(await llmMerge(BASE, THEIRS, YOURS, chat)).toBe(goodMerge());
});

test("llm merge rejects conflict markers", async () => {
  const reply = goodMerge() + "<<<<<<< theirs\nx\n=======\ny\n>>>>>>> yours\n";
  expect(await llmMerge(BASE, THEIRS, YOURS, new MockChat(reply))).toBeNull();
});

test("llm merge rejects lost or broken frontmatter", async () => {
  expect(await llmMerge(BASE, THEIRS, YOURS, new MockChat("# Kuu\n\nNo frontmatter.\n"))).toBeNull();
  // malformed YAML both engines reject (the `: not yaml [` of test_merge.py parses
  // as a mapping under the npm YAML package; an unterminated flow proves the gate
  // identically across engines).
  const broken = "---\nkey: [oops\n---\n\n# Kuu\n";
  expect(await llmMerge(BASE, THEIRS, YOURS, new MockChat(broken))).toBeNull();
});

test("llm merge rejects empty and survives backend failure", async () => {
  expect(await llmMerge(BASE, THEIRS, YOURS, new MockChat("   \n"))).toBeNull();

  class Down implements ChatClient {
    complete(): string {
      throw new ChatUnavailable("backend down");
    }
  }
  expect(await llmMerge(BASE, THEIRS, YOURS, new Down())).toBeNull();
});

test("llm merge two acknowledges the missing ancestor", async () => {
  const chat = new MockChat(goodMerge());
  const merged = await llmMergeTwo(THEIRS, YOURS, chat);
  expect(merged).toBe(goodMerge());
  expect(chat.calls.length).toBe(1);
  const [system, user] = chat.calls[0]!;
  expect(system).toBe(MERGE_SYSTEM_TWO);
  expect(system.toLowerCase()).toContain("ancestor");
  expect(user).not.toContain("BASE"); // two inputs only — the prompt stays honest
});

// -- resolve: the ladder ---------------------------------------------------------------

test("resolve prefers mechanical three-way", async () => {
  const chat = new MockChat("never used");
  const proposal = await resolve(BASE, THEIRS, YOURS, chat);
  expect(proposal).not.toBeNull();
  expect(proposal!.strategy).toBe("three-way");
  expect(proposal!.content).toContain("waxing crescent");
  expect(chat.calls).toEqual([]); // the model is never bothered when mechanics suffice
});

test("resolve falls back to llm on overlap", async () => {
  const theirs = BASE.replaceAll("The moon pulls the tides.", "Their line.");
  const yours = BASE.replaceAll("The moon pulls the tides.", "Your line.");
  const proposal = await resolve(BASE, theirs, yours, new MockChat(goodMerge()));
  expect(proposal).toEqual({ content: goodMerge(), strategy: "llm" });
});

test("resolve overlap without a model is manual", async () => {
  const theirs = BASE.replaceAll("The moon pulls the tides.", "Their line.");
  const yours = BASE.replaceAll("The moon pulls the tides.", "Your line.");
  expect(await resolve(BASE, theirs, yours, null)).toBeNull();
});

test("resolve without base uses the two-input prompt", async () => {
  const chat = new MockChat(goodMerge());
  const proposal = await resolve(null, THEIRS, YOURS, chat);
  expect(proposal).toEqual({ content: goodMerge(), strategy: "llm" });
  expect(chat.calls[0]![0]).toBe(MERGE_SYSTEM_TWO); // no base → never pretend there was one
});

test("resolve without base or model is manual", async () => {
  expect(await resolve(null, THEIRS, YOURS, null)).toBeNull();
});

test("resolve insane model output is manual", async () => {
  const theirs = BASE.replaceAll("The moon pulls the tides.", "Their line.");
  const yours = BASE.replaceAll("The moon pulls the tides.", "Your line.");
  expect(await resolve(BASE, theirs, yours, new MockChat("<<<<<<< nope\n"))).toBeNull();
});

// -- the base: git HEAD, hash-verified -------------------------------------------------

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@test", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "ignore" },
  );
}

/** A bundle whose committed kuu.md is BASE, but whose working tree moved to THEIRS. */
function committedBundle(): string {
  const bundle = join(tempDir(), "bundle");
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, "kuu.md"), BASE, "utf8");
  git(bundle, "init", "-q");
  git(bundle, "add", "-A");
  git(bundle, "commit", "-qm", "base");
  writeFileSync(join(bundle, "kuu.md"), THEIRS, "utf8"); // the tree moved on
  return bundle;
}

test("gitBase returns the committed bytes", () => {
  const bundle = committedBundle();
  expect(gitBase(bundle, "kuu.md")!.equals(Buffer.from(BASE, "utf8"))).toBe(true);
  expect(gitBase(bundle, "olematon.md")).toBeNull(); // never committed
});

test("gitBase outside any repo is null", () => {
  const lone = join(tempDir(), "lone");
  mkdirSync(lone, { recursive: true });
  writeFileSync(join(lone, "kuu.md"), BASE, "utf8");
  expect(gitBase(lone, "kuu.md")).toBeNull();
});

test("gitBase scopes to a bundle subdir", () => {
  const repo = join(tempDir(), "repo");
  const bundle = join(repo, "docs");
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, "kuu.md"), BASE, "utf8");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  expect(gitBase(bundle, "kuu.md")!.equals(Buffer.from(BASE, "utf8"))).toBe(true); // HEAD:./kuu.md
});

test("findBase only trusts a hash-verified HEAD", () => {
  const bundle = committedBundle();
  const baseSha = sha256Hex(Buffer.from(BASE, "utf8"));
  expect(findBase(bundle, "kuu.md", baseSha)).toBe(BASE);
  // The writer read something HEAD is not — a guessed base would merge wrongly.
  expect(findBase(bundle, "kuu.md", sha256Hex(Buffer.from("elsewhere", "utf8")))).toBeNull();
  expect(findBase(bundle, "olematon.md", baseSha)).toBeNull();
});
