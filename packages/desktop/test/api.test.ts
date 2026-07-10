/** The control API (_todo.md): a real Express server on an
 * ephemeral port, hit with plain fetch — the twin pattern to the engine's
 * own e2e-serve.test.ts. */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { createApi } from "../src/api";
import { ensureDaemonToken } from "../src/daemonToken";
import type { Env } from "../src/paths";
import { createRegistryStore } from "../src/registry";
import { Supervisor } from "../src/supervisor";

const dirs: string[] = [];
const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of servers.splice(0)) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolatedEnv(): Env {
  const configDir = mkdtempSync(join(tmpdir(), "bp-desktop-api-config-"));
  const dataDir = mkdtempSync(join(tmpdir(), "bp-desktop-api-data-"));
  dirs.push(configDir, dataDir);
  return { BRAINPICK_DAEMON_CONFIG_DIR: configDir, BRAINPICK_DAEMON_DATA_DIR: dataDir };
}

/** A minimal OKF-shaped bundle on disk, for POST /daemon/brains to compile. */
function makeBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "bp-desktop-api-bundle-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "index.md"),
    "---\nokf_version: \"0.1\"\n---\n\n# Index\n\nSee [Kuu](kuu.md).\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "kuu.md"),
    "---\ntype: Concept\ntitle: Kuu\ndescription: The moon.\n---\n\n# Kuu\n\nThe moon.\n",
    "utf8",
  );
  return dir;
}

async function startApi(env: Env, supervisor = new Supervisor()) {
  const registryStore = createRegistryStore(env);
  const app = createApi({ env, supervisor, registryStore });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  servers.push(async () => {
    supervisor.stopAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { base: `http://127.0.0.1:${port}`, registryStore, supervisor };
}

async function call(base: string, path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
}

// -- auth --------------------------------------------------------------------------

test("every /daemon route 401s without a token", async () => {
  const env = isolatedEnv();
  const { base } = await startApi(env);
  const health = await call(base, "/daemon/health", null);
  expect(health.status).toBe(401);
  const brains = await call(base, "/daemon/brains", null);
  expect(brains.status).toBe(401);
});

// -- CORS: a webview (the desktop app, or any browser-based client) is a different ---
// origin from the control API's own port — without CORS headers the response is
// fetched fine server-side but the BROWSER refuses to hand it to JS, which is
// invisible to curl/server-side tests and only shows up as a silent frontend failure.

test("a CORS preflight (OPTIONS) succeeds without a token and carries the right headers", async () => {
  const env = isolatedEnv();
  const { base } = await startApi(env);
  const res = await fetch(`${base}/daemon/brains`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:1420",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
});

test("a real GET response carries Access-Control-Allow-Origin so the browser hands it to JS", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const res = await fetch(`${base}/daemon/health`, {
    headers: { Authorization: `Bearer ${token}`, Origin: "http://localhost:1420" },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

test("a wrong token also 401s", async () => {
  const env = isolatedEnv();
  ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/health", "not-the-token");
  expect(result.status).toBe(401);
});

test("the real token gets in, and health reports the version (the app's compatibility check)", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/health", token);
  expect(result.status).toBe(200);
  expect(result.body.ok).toBe(true);
  expect(result.body.version).toMatch(/^\d+\.\d+\.\d+/);
});

// -- brains: list, add, remove -------------------------------------------------------

test("GET /daemon/brains starts empty", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/brains", token);
  expect(result.body).toEqual({ brains: [] });
});

test("POST /daemon/brains requires a repo", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(result.status).toBe(400);
  expect(result.body.error).toMatch(/repo/);
});

test("POST /daemon/brains rejects a local path that does not exist", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: "/no/such/path/anywhere" }),
  });
  expect(result.status).toBe(400);
  expect(result.body.error).toMatch(/does not exist/);
});

test("POST /daemon/brains compiles a real local bundle and registers it", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const { base, registryStore } = await startApi(env, new Supervisor({ command: () => ({ node: "true", cliPath: "" }) }));
  const result = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, enabled: false }),
  });
  expect(result.status).toBe(201);
  expect(result.body.brain.repo).toBe(bundle);
  expect(result.body.brain.id).toMatch(/^[a-z0-9]{21}$/);
  expect(result.body.bundle.kind).toBe("okf");
  expect(result.body.compiled.docs).toBe(2);
  expect(result.body.fix_list).toBeNull(); // no henxels.yaml in this fixture

  expect(registryStore.get().brains).toHaveLength(1);
});

test("POST /daemon/brains does not hang forever if `henxels check --all` hangs", async () => {
  const env: Env = { ...isolatedEnv(), BRAINPICK_HENXELS_TIMEOUT_MS: "200" };
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  writeFileSync(join(bundle, "henxels.yaml"), "rules: []\n", "utf8");

  const fakeHenxelsDir = mkdtempSync(join(tmpdir(), "bp-desktop-fake-henxels-"));
  dirs.push(fakeHenxelsDir);
  writeFileSync(join(fakeHenxelsDir, "henxels"), "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
  env["PATH"] = `${fakeHenxelsDir}:${process.env["PATH"] ?? ""}`;

  const { base } = await startApi(env, new Supervisor({ command: () => ({ node: "true", cliPath: "" }) }));
  const started = Date.now();
  const result = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, enabled: false }),
  });
  expect(Date.now() - started).toBeLessThan(4000); // the whole request, not just the hang
  expect(result.status).toBe(201);
  expect(result.body.fix_list).toMatch(/did not finish/);
});

test("POST /daemon/brains with enabled: false never starts a supervised process", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const supervisor = new Supervisor({ command: () => ({ node: "true", cliPath: "" }) });
  const { base } = await startApi(env, supervisor);
  const result = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, enabled: false }),
  });
  expect(supervisor.status(result.body.brain.id)).toBeUndefined();
});

test("DELETE /daemon/brains/:id removes it and 404s on an unknown id", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const { base, registryStore } = await startApi(env, new Supervisor({ command: () => ({ node: "true", cliPath: "" }) }));
  const created = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, enabled: false }),
  });
  const id = created.body.brain.id;

  const missing = await call(base, "/daemon/brains/nope", token, { method: "DELETE" });
  expect(missing.status).toBe(404);

  const deleted = await call(base, `/daemon/brains/${id}`, token, { method: "DELETE" });
  expect(deleted.status).toBe(204);
  expect(registryStore.get().brains).toHaveLength(0);
});

// -- status --------------------------------------------------------------------------

test("GET /daemon/brains/:id/status 404s for an unknown id", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/brains/nope/status", token);
  expect(result.status).toBe(404);
});

test("GET /daemon/brains/:id/status reports process_status and the MCP snippet even when not running", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const { base } = await startApi(env, new Supervisor({ command: () => ({ node: "true", cliPath: "" }) }));
  const created = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, port: 59999, enabled: false }),
  });
  const id = created.body.brain.id;

  const status = await call(base, `/daemon/brains/${id}/status`, token);
  expect(status.status).toBe(200);
  expect(status.body.process_status).toBe("stopped");
  expect(status.body.port).toBe(59999);
  expect(status.body.mcp_url).toBe("http://127.0.0.1:59999/mcp");
  expect(status.body.mcp_url_local).toBe("http://127.0.0.1:59999/mcp");
  expect(status.body.claude_mcp_add).toContain("claude mcp add --transport http");
  expect(status.body.claude_mcp_add).not.toContain("Authorization"); // local-only — no token needed
  expect(status.body.engine_status).toBeNull(); // nothing is listening on that port
});

test("a LAN-bound brain's status advertises the configured host and carries a bearer token", async () => {
  const env = { ...isolatedEnv(), BRAINPICK_DAEMON_ADVERTISE_HOST: "203.0.113.5" };
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const { base } = await startApi(env, new Supervisor({ command: () => ({ node: "true", cliPath: "" }) }));
  const created = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, port: 59998, host: "0.0.0.0", enabled: false }),
  });
  const id = created.body.brain.id;

  const status = await call(base, `/daemon/brains/${id}/status`, token);
  expect(status.body.mcp_url).toBe("http://203.0.113.5:59998/mcp");
  expect(status.body.mcp_url_local).toBe("http://127.0.0.1:59998/mcp");
  expect(status.body.claude_mcp_add).toMatch(
    new RegExp(`^claude mcp add --transport http ${id} http://203\\.0\\.113\\.5:59998/mcp` +
      ' --header "Authorization: Bearer bp_[0-9a-f]+"$'),
  );
});

test("a LAN-bound brain's token is stable across repeated status calls", async () => {
  const env = { ...isolatedEnv(), BRAINPICK_DAEMON_ADVERTISE_HOST: "203.0.113.5" };
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const { base } = await startApi(env, new Supervisor({ command: () => ({ node: "true", cliPath: "" }) }));
  const created = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, port: 59997, host: "0.0.0.0", enabled: false }),
  });
  const id = created.body.brain.id;

  const first = await call(base, `/daemon/brains/${id}/status`, token);
  const second = await call(base, `/daemon/brains/${id}/status`, token);
  expect(second.body.claude_mcp_add).toBe(first.body.claude_mcp_add);
});

test("a brain the Supervisor actually runs answers its own /api/status through the daemon", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const supervisor = new Supervisor(); // real engine command (resolveEngineCommand default)
  const { base } = await startApi(env, supervisor);
  const created = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, enabled: true }),
  });
  const id = created.body.brain.id;

  const start = Date.now();
  let status: { status: number; body: any } | undefined;
  while (Date.now() - start < 10_000) {
    status = await call(base, `/daemon/brains/${id}/status`, token);
    if (status.body.engine_status !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(status!.body.process_status).toBe("running");
  expect(status!.body.engine_status).not.toBeNull();
  expect(status!.body.engine_status.docs).toBe(2);
}, 15_000);

test("a LAN-bound brain the Supervisor actually runs still answers through the daemon — the auth-provisioned token reaches the real engine", async () => {
  // once a real token exists, the ENGINE itself starts requiring auth
  // (spec/80) — this proves the daemon's own status probe forwards the
  // provisioned token, not just that it constructs the right URL string.
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const supervisor = new Supervisor(); // real engine command (resolveEngineCommand default)
  const { base } = await startApi(env, supervisor);
  const created = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: bundle, host: "0.0.0.0", enabled: true }),
  });
  const id = created.body.brain.id;

  const start = Date.now();
  let status: { status: number; body: any } | undefined;
  while (Date.now() - start < 10_000) {
    status = await call(base, `/daemon/brains/${id}/status`, token);
    if (status.body.engine_status !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(status!.body.process_status).toBe("running");
  expect(status!.body.claude_mcp_add).toContain("Authorization: Bearer bp_");
  expect(status!.body.engine_status).not.toBeNull(); // would be null forever without the auth-forwarding fix
  expect(status!.body.engine_status.docs).toBe(2);
}, 15_000);

// -- keys --------------------------------------------------------------------------

test("POST /daemon/keys with no id mints a fresh brain id, for the private-repo wizard flow", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(result.status).toBe(200);
  expect(result.body.id).toMatch(/^[a-z0-9]{21}$/);
  expect(result.body.public_key).toMatch(/^ssh-ed25519 /);
});

test("POST /daemon/keys with no id mints a DIFFERENT id each call", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const first = await call(base, "/daemon/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const second = await call(base, "/daemon/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(second.body.id).not.toBe(first.body.id);
});

test("POST /daemon/keys rejects a non-string id", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const result = await call(base, "/daemon/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: 123 }),
  });
  expect(result.status).toBe(400);
});

test("the minted id from POST /daemon/keys can register the brain via POST /daemon/brains", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const bundle = makeBundle();
  const { base } = await startApi(env, new Supervisor({ command: () => ({ node: "true", cliPath: "" }) }));

  const key = await call(base, "/daemon/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const created = await call(base, "/daemon/brains", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: key.body.id, repo: bundle, enabled: false }),
  });
  expect(created.status).toBe(201);
  expect(created.body.brain.id).toBe(key.body.id);
});

test("POST /daemon/keys mints an ssh-ed25519 public key and is idempotent", async () => {
  const env = isolatedEnv();
  const token = ensureDaemonToken(env);
  const { base } = await startApi(env);
  const first = await call(base, "/daemon/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "a" }),
  });
  expect(first.body.public_key).toMatch(/^ssh-ed25519 /);
  const second = await call(base, "/daemon/keys", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "a" }),
  });
  expect(second.body.public_key).toBe(first.body.public_key);
});
