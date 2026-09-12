/** The proactive new-version notice (spec/80 [update] check): a cached, silent,
 * opt-out registry lookup whose result surfaces where agents already look. */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { renderReportBlock } from "../src/compile/t1";
import { loadConfig } from "../src/config";
import { CACHE_TTL_S, checkForUpdate, isNewer, noticeFor, registryUrl } from "../src/update";
import { cleanup, copyBundle, tempDir } from "./helpers";

afterEach(cleanup);

const TIERS = { t1: "fresh", t2: "off", t3: "off" };

test("isNewer compares the semver core only", () => {
  expect(isNewer("0.5.0", "0.6.0")).toBe(true);
  expect(isNewer("0.5.0", "0.5.1")).toBe(true);
  expect(isNewer("0.9.9", "1.0.0")).toBe(true);
  expect(isNewer("0.6.0", "0.6.0")).toBe(false);
  expect(isNewer("0.6.0", "0.5.9")).toBe(false);
  expect(isNewer("0.5.0", "0.6.0-rc.1")).toBe(false); // a pre-release never counts as newer
  expect(isNewer("0.5.0", "garbage")).toBe(false);
  expect(isNewer("0.5.0", "")).toBe(false);
});

test("notice names the exact upgrade command", () => {
  expect(noticeFor("node", "0.5.0", "0.6.0")).toEqual({
    current: "0.5.0",
    latest: "0.6.0",
    hint: "npm install -g brainpick",
  });
  expect(noticeFor("python", "0.5.0", "0.6.0")!.hint).toBe("pip install -U brainpick");
  expect(noticeFor("node", "0.6.0", "0.6.0")).toBeNull();
});

test("registry url per engine", () => {
  expect(registryUrl("python")).toBe("https://pypi.org/pypi/brainpick/json");
  expect(registryUrl("node")).toBe("https://registry.npmjs.org/brainpick/latest");
});

test("check fetches once then serves the cache", async () => {
  const dir = tempDir();
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    return "0.6.0";
  };
  const first = await checkForUpdate("node", "0.5.0", { env: {}, cacheDir: dir, fetch });
  expect(first).toEqual({ current: "0.5.0", latest: "0.6.0", hint: "npm install -g brainpick" });
  const cached = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
  expect(cached.impl).toBe("node");
  expect(cached.latest).toBe("0.6.0");
  expect(cached).toHaveProperty("checked_at");

  const second = await checkForUpdate("node", "0.5.0", { env: {}, cacheDir: dir, fetch });
  expect(second).toEqual(first);
  expect(calls).toEqual(["https://registry.npmjs.org/brainpick/latest"]); // once per 24 h
});

test("check refetches after the ttl", async () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "latest.json"),
    JSON.stringify({ impl: "node", latest: "0.5.0", checked_at: Date.now() / 1000 - CACHE_TTL_S - 1 }),
  );
  const result = await checkForUpdate("node", "0.5.0", { env: {}, cacheDir: dir, fetch: async () => "0.7.0" });
  expect(result?.latest).toBe("0.7.0");
});

test("a miss is silent and cached as a miss", async () => {
  const dir = tempDir();
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    return null;
  };
  expect(await checkForUpdate("node", "0.5.0", { env: {}, cacheDir: dir, fetch })).toBeNull();
  expect(await checkForUpdate("node", "0.5.0", { env: {}, cacheDir: dir, fetch })).toBeNull();
  expect(calls).toEqual([registryUrl("node")]); // a miss is not retried until the TTL passes
});

test("opt-out never touches the network or the cache", async () => {
  const dir = tempDir();
  const fetch = async (_url: string): Promise<string | null> => {
    throw new Error("must not be called");
  };
  for (const env of [{ BRAINPICK_UPDATE_CHECK: "false" }, { BRAINPICK_UPDATE_CHECK: "0" }]) {
    expect(await checkForUpdate("node", "0.5.0", { env, cacheDir: dir, fetch })).toBeNull();
  }
  expect(await checkForUpdate("node", "0.5.0", { env: {}, cacheDir: dir, fetch, enabled: false })).toBeNull();
  expect(existsSync(join(dir, "latest.json"))).toBe(false);
});

test("the check is off in the test suite", () => {
  expect(process.env["BRAINPICK_UPDATE_CHECK"]).toBe("false"); // test/setup.ts — no test hits npm
});

test("report carries the engine line only with a notice", () => {
  const graph = { nodes: [], edges: [], ghosts: [], islands: [], tags: {},
    stats: { docs: 0, edges: 0, tags: 0, orphans: 0, ghosts: 0 } };
  const plain = renderReportBlock(graph as never, TIERS, "docs");
  expect(plain).not.toContain("Engine:");
  const notice = { current: "0.5.0", latest: "0.6.0", hint: "npm install -g brainpick" };
  const body = renderReportBlock(graph as never, TIERS, "docs", null, null, notice).split("\n");
  expect(body[body.length - 3]).toBe("- Bundle root: docs");
  expect(body[body.length - 2]).toBe("- Engine: brainpick 0.5.0 — 0.6.0 available: npm install -g brainpick");
  expect(body[body.length - 1]!.startsWith("<!-- brainpick:end")).toBe(true);
});

test("update check is config and env", () => {
  const root = copyBundle();
  // env {} — the suite itself sets BRAINPICK_UPDATE_CHECK=false (test/setup.ts), which is the point
  expect(loadConfig(root, {}).update.check).toBe(true);
  writeFileSync(join(root, "brainpick.local.toml"), "[update]\ncheck = false\n");
  expect(loadConfig(root, {}).update.check).toBe(false);
  rmSync(join(root, "brainpick.local.toml"));
  expect(loadConfig(root, { BRAINPICK_UPDATE_CHECK: "false" }).update.check).toBe(false);
});
