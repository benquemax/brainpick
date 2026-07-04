/** e2e: the MCP server over real stdio — spawn `node dist/cli.js mcp`, speak the
 * protocol (the twin of test_e2e_mcp.py, plus the spec/70 base_sha round trip). */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeAll, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { sha256Hex } from "../src/core/canonical";
import { PACKAGE_ROOT } from "../src/version";
import { cleanup, copyBundle, stageT3Export } from "./helpers";

const CLI = join(PACKAGE_ROOT, "dist", "cli.js");

const NEW_DOC =
  "---\ntype: Concept\ntitle: Uusi kivi\ndescription: A new rock.\n---\n\n# Uusi kivi\n\nNear [Kuu](kuu.md).\n";

beforeAll(() => {
  // the e2e spawns the built CLI — build once when dist is missing or stale
  if (!existsSync(CLI)) {
    execFileSync("npm", ["run", "build", "--silent"], { cwd: PACKAGE_ROOT, stdio: "ignore" });
  }
}, 180_000);

afterEach(cleanup);

async function withSession<T>(root: string, scenario: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp", "--root", root],
    stderr: "ignore",
  });
  const client = new Client({ name: "brainpick-e2e", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await scenario(client);
  } finally {
    await client.close();
  }
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  expect(Boolean(result.isError)).toBe(false);
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text);
}

test("mcp stdio roundtrip", { timeout: 120_000 }, async () => {
  const root = copyBundle();
  await runCompile(root);
  const kuuSha = sha256Hex(readFileSync(join(root, "kuu.md")));

  await withSession(root, async (client) => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(new Set(tools)).toEqual(
      new Set(["brain_overview", "brain_search", "brain_read", "brain_neighbors", "brain_write"]),
    );

    const overview = await call(client, "brain_overview", {});
    expect(overview.counts.docs).toBe(10);
    expect(overview.hint).toBeTruthy();

    const search = await call(client, "brain_search", { query: "aurinko" });
    expect(search.hits.map((h: { path: string }) => h.path)).toContain("aurinko.md");
    expect(search.used_modes).toEqual(["keyword"]);

    const readResult = await call(client, "brain_read", { doc: "kuu" }); // stem resolution
    expect(readResult.path).toBe("kuu.md");
    expect(readResult.content).toContain("tides");
    expect(new Set(readResult.neighbors.out.map((n: { path: string }) => n.path))).toEqual(new Set(["maa.md"]));

    const neighbors = await call(client, "brain_neighbors", { doc: "maa.md" });
    expect(neighbors.center).toBe("maa.md");
    expect(new Set(neighbors.nodes.map((n: { path: string }) => n.path))).toEqual(
      new Set(["maa.md", "kuu.md", "planeetat.md", "index.md"]),
    );

    const written = await call(client, "brain_write", { doc: "uusi-kivi", content: NEW_DOC });
    expect(written.ok).toBe(true);
    expect(written.path).toBe("uusi-kivi.md");
    expect(written.seq).toBe(2);

    const rejected = await call(client, "brain_write", { doc: "../ulos.md", content: "# Ulos\n" });
    expect(rejected.ok).toBe(false);
    expect(rejected.instruction).toBeTruthy();

    // spec/70 optimistic concurrency: a stale base_sha conflicts without writing…
    const conflict = await call(client, "brain_write", {
      doc: "kuu.md",
      content: "# Kuu\n\nRewritten over the tides.\n",
      mode: "replace",
      base_sha: "0".repeat(64),
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.conflict).toBe(true);
    expect(conflict.current_sha).toBe(kuuSha);
    expect(conflict.theirs).toContain("tides");
    expect(conflict.instruction).toContain("re-read");
    expect(conflict.merged).toBeUndefined(); // the merge resolver is a later chunk

    // …and retrying with the sha the server named succeeds and bumps seq.
    const retried = await call(client, "brain_write", {
      doc: "kuu.md",
      content: "# Kuu\n\nRewritten over the tides.\n",
      mode: "replace",
      base_sha: conflict.current_sha,
    });
    expect(retried.ok).toBe(true);
    expect(retried.seq).toBe(3);

    const resources = await client.listResources();
    expect(resources.resources.map((r) => String(r.uri))).toContain("brain://index");
  });

  const text = readFileSync(join(root, "uusi-kivi.md"), "utf8");
  expect(text).toMatch(/^timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
  const manifest = JSON.parse(readFileSync(join(root, ".brainpick", "manifest.json"), "utf8"));
  expect(manifest.seq).toBe(3);
  expect(existsSync(join(root, "..", "ulos.md"))).toBe(false);
  expect(readFileSync(join(root, "kuu.md"), "utf8")).toContain("Rewritten over the tides.");
});

test("mcp semantic search over mock vectors", { timeout: 120_000 }, async () => {
  const root = copyBundle();
  writeFileSync(join(root, "brainpick.toml"), '[models.embedding]\nkind = "mock"\n', "utf8");
  await runCompile(root);
  const manifest = JSON.parse(readFileSync(join(root, ".brainpick", "manifest.json"), "utf8"));
  expect(manifest.tiers.t2).toBe("fresh");

  await withSession(root, async (client) => {
    const semantic = await call(client, "brain_search", { query: "kuu vuorovesi maa", mode: "semantic" });
    expect(semantic.used_modes).toEqual(["semantic"]);
    expect(semantic.degraded_from).toBeNull();
    expect(semantic.hits.length).toBeGreaterThan(0);

    const fused = await call(client, "brain_search", { query: "aurinko", mode: "auto" });
    expect(fused.used_modes).toEqual(["keyword", "semantic"]);
    expect(fused.degraded_from).toBeNull();
    expect(fused.hits.map((h: { path: string }) => h.path)).toContain("aurinko.md");
  });
});

test("mcp t3 entity queries", { timeout: 120_000 }, async () => {
  const root = copyBundle();
  await runCompile(root);
  stageT3Export(root); // the reader loads the staged export; no extractor runs

  await withSession(root, async (client) => {
    const neighbors = await call(client, "brain_neighbors", { doc: "kuu.md", layer: "entities" });
    expect(neighbors.center).toBe("kuu.md");
    expect(new Set(neighbors.nodes.map((n: { id: string }) => n.id))).toEqual(
      new Set(["kuu", "maa", "vuorovesi", "planeetat"]),
    );
    expect(neighbors.degraded_from).toBeNull(); // T3 export present — the real layer
    const grounding = new Set<string>(
      neighbors.nodes.flatMap((n: { source_docs: string[] }) => n.source_docs),
    );
    expect(grounding).toEqual(new Set(["aurinko.md", "kuu.md", "maa.md", "planeetat.md"]));
    expect(neighbors.edges).toContainEqual({ src: "kuu", dst: "vuorovesi" });

    const orbits = await call(client, "brain_search", {
      query: "what orbits the star",
      mode: "graph",
      limit: 4,
    });
    expect(new Set(orbits.hits.map((h: { path: string }) => h.path))).toEqual(
      new Set(["aurinko.md", "komeetta.md", "maa.md", "planeetat.md"]),
    );
    expect(orbits.used_modes).toEqual(["graph"]);
    expect(orbits.degraded_from).toBeNull();
    expect(orbits.hits.every((h: { why: string }) => h.why.includes("entity graph"))).toBe(true);
  });
});
