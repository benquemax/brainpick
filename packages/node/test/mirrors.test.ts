/** The four CLI query mirrors (spec/70 payloads in the terminal). Twin of the
 * Python cli.py query-mirror tests. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { neighborsMirror, overviewMirror, readMirror, searchMirror } from "../src/query/mirrors";
import { cleanup, copyBundle } from "./helpers";

afterEach(cleanup);

describe("query mirrors", () => {
  test("search self-heals when the brain is not compiled", async () => {
    const result = await searchMirror(copyBundle(), "aurinko", "auto", 8, false);
    expect(result.out).toBeUndefined();
    expect(result.err).toContain("no compiled brain");
    expect(result.err).toContain("brainpick compile");
  });

  test("an uncompiled brain in --json mode emits a JSON error", async () => {
    const result = await searchMirror(copyBundle(), "aurinko", "auto", 8, true);
    const payload = JSON.parse(result.out!) as { error: string; hint: string };
    expect(payload.error).toContain("no compiled brain");
    expect(payload.hint).toBeDefined();
  });

  test("search plain and --json over a compiled brain", async () => {
    const root = copyBundle();
    await runCompile(root);
    expect((await searchMirror(root, "aurinko", "auto", 8, false)).out).toContain("aurinko.md");
    const json = await searchMirror(root, "aurinko", "auto", 8, true);
    const payload = JSON.parse(json.out!) as { hits: Array<{ path: string }>; used_modes: string[] };
    expect(payload.hits[0]!.path).toBe("aurinko.md");
    expect(payload.used_modes).toBeDefined();
  });

  test("read, neighbors and overview answer", async () => {
    const root = copyBundle();
    await runCompile(root);
    expect((await readMirror(root, "kuu", false)).out).toContain("Kuu");
    const neighbors = await neighborsMirror(root, "kuu", 1, "links", true);
    expect((JSON.parse(neighbors.out!) as { center: string }).center).toBe("kuu.md");
    expect((await overviewMirror(root, false)).out).toContain("counts:");
  });

  test("a stale brain is flagged but still answers on the held artifacts", async () => {
    const root = copyBundle();
    await runCompile(root);
    const kuu = join(root, "kuu.md");
    writeFileSync(kuu, readFileSync(kuu, "utf8") + "\nAn edit that outpaces the artifacts.\n", "utf8");
    const result = await searchMirror(root, "aurinko", "auto", 8, false);
    expect(result.err).toContain("stale");
    expect(result.out).toContain("aurinko.md");
  });
});
