/** init/doctor choreography (docs/onboarding.md): detect, propose, compile, glow —
 * config written once and never clobbered, every error an instruction, dry-run inert.
 * The twin of packages/python/tests/test_scaffold.py, with the spec/80 layering
 * update: detected backends land in brainpick.local.toml, not the shared file. */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, expect, test } from "vitest";

import { runCompile } from "../src/compile/pipeline";
import { loadConfig } from "../src/config";
import { runDoctor, runInit } from "../src/scaffold";
import { PACKAGE_ROOT } from "../src/version";
import type { Backend, ProbeResult } from "../src/detect";
import { cleanup, copyBundle, tempDir } from "./helpers";

afterEach(cleanup);

const NO_BACKENDS: ProbeResult[] = [
  ["ollama", null],
  ["lm studio", null],
  ["llama.cpp", null],
];
const OLLAMA: Backend = { kind: "ollama", endpoint: "http://127.0.0.1:11434", model: "nomic-embed-text:latest" };
const OLLAMA_FOUND: ProbeResult[] = [
  ["ollama", OLLAMA],
  ["lm studio", null],
  ["llama.cpp", null],
];

function capture(): { print: (line: string) => void; text: () => string } {
  const lines: string[] = [];
  return { print: (line) => lines.push(line), text: () => lines.join("\n") + "\n" };
}

function typedBundle(root: string): string {
  mkdirSync(root, { recursive: true });
  for (const name of ["yksi", "kaksi", "kolme"]) {
    writeFileSync(
      join(root, `${name}.md`),
      `---\ntype: Concept\ntitle: ${name}\ndescription: doc ${name}\n---\n\n# ${name}\n\nSee [yksi](yksi.md).\n`,
      "utf8",
    );
  }
  return root;
}

// -- init --------------------------------------------------------------------------

test("init full choreography", async () => {
  const root = copyBundle();
  const out = capture();
  expect(await runInit(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(0);
  const text = out.text();

  const configPath = join(root, "brainpick.toml");
  expect(existsSync(configPath)).toBe(true);
  const configText = readFileSync(configPath, "utf8");
  expect(configText).toContain('vectors = "auto"');
  expect(configText).not.toContain("[models.embedding]");
  const warnings: string[] = [];
  loadConfig(root, {}, (m) => warnings.push(m));
  expect(warnings).toEqual([]); // the template must be fully known to the loader

  expect(existsSync(join(root, ".brainpick", "manifest.json"))).toBe(true);
  expect(existsSync(join(root, ".brainpick", "t1", "graph.json"))).toBe(true);
  expect(text).toContain("10 docs");
  expect(text).toContain("your brain, compiled");

  expect(text).toContain(join(resolve(PACKAGE_ROOT), "dist", "cli.js")); // the MCP snippet points at this checkout
  expect(text).toContain(resolve(root));
  expect(text).toContain("claude mcp add brainpick");
  expect(text).toContain('"mcpServers"');
  expect(text).toContain('"type": "local"'); // the opencode block
  expect(text).toContain("npx brainpick mcp"); // the once-published note
  expect(text).toContain("Serve the brain:");
  expect(text).toContain("--open");
});

test("init never clobbers an existing config", async () => {
  const root = copyBundle();
  const marker = '# hand-tuned\nspec = "0.1"\n';
  writeFileSync(join(root, "brainpick.toml"), marker, "utf8");
  const out = capture();
  expect(await runInit(root, { env: {}, probes: OLLAMA_FOUND, print: out.print })).toBe(0);
  expect(readFileSync(join(root, "brainpick.toml"), "utf8")).toBe(marker);
  expect(out.text()).toContain("left untouched");
});

test("init dry-run writes nothing", async () => {
  const root = copyBundle();
  const indexBefore = readFileSync(join(root, "index.md"), "utf8");
  const out = capture();
  expect(await runInit(root, { dryRun: true, env: {}, probes: NO_BACKENDS, print: out.print })).toBe(0);
  expect(out.text()).toContain("dry run");
  expect(existsSync(join(root, "brainpick.toml"))).toBe(false);
  expect(existsSync(join(root, ".brainpick"))).toBe(false);
  expect(readFileSync(join(root, "index.md"), "utf8")).toBe(indexBefore);
});

test("init empty dir hands the scaffold to henxels", async () => {
  const empty = join(tempDir(), "tyhja");
  mkdirSync(empty);
  const out = capture();
  expect(await runInit(empty, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(1);
  const text = out.text();
  expect(text).toContain("uv tool install henxels");
  expect(text).toContain("henxels init --template okf-llm-wiki --wiki-dir .");
  expect(readdirSync(empty)).toEqual([]); // never reimplement the wiki template
});

test("init missing root is an instruction", async () => {
  const out = capture();
  expect(await runInit(join(tempDir(), "olematon"), { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(1);
  expect(out.text()).toContain("olematon");
});

test("init records a detected backend in brainpick.local.toml", async () => {
  const root = copyBundle();
  const out = capture();
  expect(await runInit(root, { env: {}, probes: OLLAMA_FOUND, print: out.print })).toBe(0);
  const shared = readFileSync(join(root, "brainpick.toml"), "utf8");
  expect(shared).not.toContain("[models.embedding]"); // shared policy stays endpoint-free (spec/80)
  const local = readFileSync(join(root, "brainpick.local.toml"), "utf8");
  expect(local).toContain("[models.embedding]");
  expect(local).toContain('kind = "ollama"');
  expect(local).toContain('endpoint = "http://127.0.0.1:11434"');
  expect(local).toContain('model = "nomic-embed-text:latest"');
  expect(out.text()).toContain("nomic-embed-text");
  const merged = loadConfig(root, {}, () => undefined);
  expect(merged.models.embedding.kind).toBe("ollama"); // the layers merge back together
});

test("init adds brainpick.local.toml to an existing repo gitignore", async () => {
  const base = tempDir();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".brainpick/\n", "utf8");
  const bundle = typedBundle(join(repo, "wiki"));
  const out = capture();
  expect(await runInit(bundle, { env: {}, probes: OLLAMA_FOUND, print: out.print })).toBe(0);
  const expected = ".brainpick/\nbrainpick.local.toml\n.brainpick-auth.json\n";
  expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(expected);
  expect(out.text()).toContain("gitignore: brainpick.local.toml added");
  expect(out.text()).toContain("gitignore: .brainpick-auth.json added");
  // rerun: local config exists — left untouched, gitignore not duplicated
  const again = capture();
  expect(await runInit(bundle, { env: {}, probes: OLLAMA_FOUND, print: again.print })).toBe(0);
  expect(again.text()).toContain("brainpick.local.toml exists — left untouched");
  expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(expected);
});

test("init offers the pull when ollama is modelless", async () => {
  const root = copyBundle();
  const probes: ProbeResult[] = [
    ["ollama", { kind: "ollama", endpoint: "http://127.0.0.1:11434", model: null }],
    ["lm studio", null],
    ["llama.cpp", null],
  ];
  const out = capture();
  expect(await runInit(root, { env: {}, probes, print: out.print })).toBe(0);
  expect(out.text()).toContain("ollama pull nomic-embed-text");
  expect(readFileSync(join(root, "brainpick.toml"), "utf8")).not.toContain("[models.embedding]");
  expect(existsSync(join(root, "brainpick.local.toml"))).toBe(false);
});

test("init openai key stays opt-in without --yes", async () => {
  const root = copyBundle();
  const out = capture();
  expect(
    await runInit(root, { env: { OPENAI_API_KEY: "sk-test" }, probes: NO_BACKENDS, print: out.print }),
  ).toBe(0);
  const text = out.text();
  expect(text).toContain("OPENAI_API_KEY");
  expect(text).toContain("--yes"); // the instruction to opt in
  expect(existsSync(join(root, "brainpick.local.toml"))).toBe(false);
});

test("init openai key recorded with --yes", async () => {
  const root = copyBundle();
  expect(
    await runInit(root, { yes: true, env: { OPENAI_API_KEY: "sk-test" }, probes: NO_BACKENDS, print: () => undefined }),
  ).toBe(0);
  const local = readFileSync(join(root, "brainpick.local.toml"), "utf8");
  expect(local).toContain('kind = "openai"');
});

test("init suggests gitignore line for .brainpick without editing it in", async () => {
  const base = tempDir();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n", "utf8");
  const bundle = typedBundle(join(repo, "wiki"));
  const out = capture();
  expect(await runInit(bundle, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(0);
  expect(out.text()).toContain(".brainpick/");
  // artifacts stay a suggestion; the auth line is the one edit (spec/80 secrets)
  expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe("node_modules/\n.brainpick-auth.json\n");
  expect(out.text()).toContain(".brainpick-auth.json added");
});

test("init skips gitignore suggestion when covered", async () => {
  const base = tempDir();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const covered = ".brainpick/\n.brainpick-auth.json\n";
  writeFileSync(join(repo, ".gitignore"), covered, "utf8");
  const bundle = typedBundle(join(repo, "wiki"));
  const out = capture();
  expect(await runInit(bundle, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(0);
  expect(out.text()).not.toContain(".gitignore");
  expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(covered);
});

test("init prints the henxels freshness gate", async () => {
  const root = copyBundle();
  writeFileSync(join(root, "henxels.yaml"), "henxels: []\n", "utf8");
  const out = capture();
  expect(await runInit(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(0);
  const text = out.text();
  expect(text).toContain("run_before_commit:");
  expect(text).toContain("why:");
  expect(text).toContain("compile --check-fresh");
  expect(readFileSync(join(root, "henxels.yaml"), "utf8")).toBe("henxels: []\n");
});

// -- doctor ------------------------------------------------------------------------

test("doctor happy table exits zero", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  const out = capture();
  expect(await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(0);
  const text = out.text();
  expect(text).not.toContain("✗");
  expect(text).toContain("config: brainpick.toml parses");
  expect(text).toContain("bundle: OKF (10 docs)");
  expect(text).toContain("artifacts: fresh (seq 1)");
  expect(text).toContain("ollama: not reachable");
  expect(text).toContain("python engine"); // the sibling checkout line
});

test("doctor vectors line walks the states", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  const first = capture();
  await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: first.print });
  expect(first.text()).toContain("vectors: no [models.embedding]");

  writeFileSync(join(root, "brainpick.toml"), '[models.embedding]\nkind = "mock"\n', "utf8");
  await runCompile(root);
  const second = capture();
  await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: second.print });
  const text = second.text();
  expect(text).toContain("vectors: t2 fresh");
  expect(text).toContain("mock");
});

test("doctor vectors line names the missing store", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  writeFileSync(join(root, "brainpick.toml"), '[models.embedding]\nkind = "mock"\n', "utf8");
  const out = capture();
  expect(
    await runDoctor(root, {
      env: {},
      probes: NO_BACKENDS,
      print: out.print,
      lancedb: async () => false,
    }),
  ).toBe(0); // optional, never a failure
  expect(out.text()).toContain("npm install @lancedb/lancedb");
});

test("doctor defaults apply without config", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  unlinkSync(join(root, "brainpick.toml"));
  const out = capture();
  expect(await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(0);
  expect(out.text()).toContain("defaults apply");
});

test("doctor missing artifacts is an instruction", async () => {
  const root = copyBundle();
  const out = capture();
  expect(await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(1);
  const text = out.text();
  expect(text).toContain("✗ artifacts: never compiled");
  expect(text).toContain("brainpick compile");
});

test("doctor stale artifacts fail", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  const kuu = join(root, "kuu.md");
  writeFileSync(kuu, readFileSync(kuu, "utf8") + "\nUutta tekstiä.\n", "utf8");
  const out = capture();
  expect(await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(1);
  expect(out.text()).toContain("✗ artifacts: stale");
});

test("doctor broken toml fails with instruction", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  writeFileSync(join(root, "brainpick.toml"), "not = [toml\n", "utf8");
  const out = capture();
  expect(await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(1);
  expect(out.text()).toContain("✗ config");
});

test("doctor broken local toml fails with instruction", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  writeFileSync(join(root, "brainpick.local.toml"), "not = [toml\n", "utf8");
  const out = capture();
  expect(await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: out.print })).toBe(1);
  expect(out.text()).toContain("✗ config: brainpick.local.toml");
});

test("doctor reports found backends", async () => {
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  const out = capture();
  expect(await runDoctor(root, { env: {}, probes: OLLAMA_FOUND, print: out.print })).toBe(0);
  const text = out.text();
  expect(text).toContain("✓ ollama: nomic-embed-text:latest at http://127.0.0.1:11434");
  expect(text).toContain("lm studio: not reachable");
});

test("doctor auth line walks the states", async () => {
  const { authPath, createToken, setPassword } = await import("../src/auth");
  const root = copyBundle();
  await runInit(root, { env: {}, probes: NO_BACKENDS, print: () => undefined });
  const open = capture();
  await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: open.print });
  expect(open.text()).toContain("○ auth: open — no auth configured");

  createToken(root, "hermes");
  const one = capture();
  await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: one.print });
  expect(one.text()).toContain("✓ auth: 1 token · password absent");

  createToken(root);
  setPassword(root, "kotiaurinko");
  const two = capture();
  await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: two.print });
  expect(two.text()).toContain("✓ auth: 2 tokens · password set");

  writeFileSync(authPath(root), "broken {", "utf8");
  const broken = capture();
  expect(await runDoctor(root, { env: {}, probes: NO_BACKENDS, print: broken.print })).toBe(1);
  expect(broken.text()).toContain("✗ auth: .brainpick-auth.json is not valid JSON");
});
