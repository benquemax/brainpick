/** Auth (spec/80): scrypt token/password store, HMAC session cookies, gitignore hygiene.
 *
 * The pinned scrypt vector is the cross-engine contract: packages/python/tests/
 * test_auth.py asserts the SAME hex — one KDF, two runtimes, byte-identical hashes.
 * The twin of test_auth.py plus the CLI runners (print-injected, like scaffold's).
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  AUTH_FILE,
  AuthProvider,
  authActive,
  authPath,
  clearPassword,
  createToken,
  emptyStore,
  ensureGitignored,
  listTokens,
  loadAuth,
  makeSessionCookie,
  revokeToken,
  runPasswordClear,
  runPasswordSetValue,
  runTokenCreate,
  runTokenList,
  runTokenRevoke,
  scryptHash,
  setPassword,
  verifyPassword,
  verifySession,
  verifyToken,
} from "../src/auth";
import { cleanup, tempDir } from "./helpers";

afterEach(cleanup);

// Computed once with node:crypto scryptSync AND hashlib.scrypt (N=16384 r=8 p=1,
// dklen=32) — pinned literally in both suites so the engines can never drift.
const PINNED_SCRYPT_PASSWORD = "kotiaurinko";
const PINNED_SCRYPT_SALT_HEX = "000102030405060708090a0b0c0d0e0f";
const PINNED_SCRYPT_HEX = "80608aa957eedae8f1b922e3bf1ed3ede04db92345065a02ea4cf7081d2ece06";

function capture(): { print: (line: string) => void; text: () => string } {
  const lines: string[] = [];
  return { print: (line) => lines.push(line), text: () => lines.join("\n") + "\n" };
}

test("scrypt pinned vector matches both engines", () => {
  const salt = Buffer.from(PINNED_SCRYPT_SALT_HEX, "hex");
  expect(scryptHash(PINNED_SCRYPT_PASSWORD, salt).toString("hex")).toBe(PINNED_SCRYPT_HEX);
});

test("token create round trip", () => {
  const root = tempDir();
  const [tokenId, secret] = createToken(root, "hermes");
  expect(tokenId.startsWith("tk_")).toBe(true);
  expect(tokenId.length).toBe(11);
  expect(secret.startsWith("bp_")).toBe(true);
  expect(secret.length).toBe(35);

  const data = JSON.parse(readFileSync(authPath(root), "utf8"));
  expect(data.version).toBe(1);
  expect(data.tokens.length).toBe(1);
  const record = data.tokens[0];
  expect(record.id).toBe(tokenId);
  expect(record.name).toBe("hermes");
  expect(record.algo).toBe("scrypt");
  expect(record.salt.length).toBe(32); // hex16 salt
  expect(record.hash.length).toBe(64); // hex32 key
  expect(JSON.stringify(data)).not.toContain(secret); // only the salted hash is stored
  expect(record.created.endsWith("Z")).toBe(true);

  const store = loadAuth(root);
  expect(verifyToken(store, secret)).toBe(true);
  expect(verifyToken(store, "bp_" + "0".repeat(32))).toBe(false);
  expect(verifyToken(store, "")).toBe(false);
});

test("token verify checks all stored tokens", () => {
  const root = tempDir();
  const [, first] = createToken(root, "eka");
  const [, second] = createToken(root);
  const store = loadAuth(root)!;
  expect(store.tokens.length).toBe(2);
  expect(verifyToken(store, first)).toBe(true);
  expect(verifyToken(store, second)).toBe(true);
});

test("token revoke", () => {
  const root = tempDir();
  const [firstId, firstSecret] = createToken(root, "eka");
  const [, secondSecret] = createToken(root, "toka");
  expect(revokeToken(root, firstId)).toBe(true);
  expect(listTokens(root).map((record) => record.name)).toEqual(["toka"]);
  const store = loadAuth(root);
  expect(verifyToken(store, firstSecret)).toBe(false); // revoked stops working immediately
  expect(verifyToken(store, secondSecret)).toBe(true);
  expect(revokeToken(root, firstId)).toBe(false); // already gone
  expect(revokeToken(root, "tk_olematon")).toBe(false);
});

test("password set verify clear", () => {
  const root = tempDir();
  setPassword(root, "kotiaurinko");
  const store = loadAuth(root)!;
  expect(store.password).not.toBeNull();
  expect(verifyPassword(store, "kotiaurinko")).toBe(true);
  expect(verifyPassword(store, "väärä")).toBe(false);
  expect(verifyPassword(store, "")).toBe(false);
  expect(clearPassword(root)).toBe(true);
  expect(loadAuth(root)!.password).toBeNull();
  expect(verifyPassword(loadAuth(root), "kotiaurinko")).toBe(false);
  expect(clearPassword(root)).toBe(false); // nothing left to clear
});

test("session cookie expiry and tamper", () => {
  const root = tempDir();
  setPassword(root, "kotiaurinko");
  const store = loadAuth(root)!;
  const value = makeSessionCookie(store, 1_000_000);
  const cut = value.indexOf(".");
  const expiryText = value.slice(0, cut);
  const mac = value.slice(cut + 1);
  expect(expiryText).toBe(String(1_000_000 + 12 * 3600)); // 12 h expiry (spec/80)
  expect(mac.length).toBe(64);

  expect(verifySession(store, value, 1_000_000)).toBe(true);
  expect(verifySession(store, value, 1_000_000 + 12 * 3600)).toBe(false); // expired
  expect(verifySession(store, `${expiryText}.${"0".repeat(64)}`, 1_000_000)).toBe(false); // tampered
  expect(verifySession(store, `${parseInt(expiryText, 10) + 1}.${mac}`, 1_000_000)).toBe(false);
  for (const garbage of ["", "kissa", "123", "123.", ".abc", "12a3.ffff"]) {
    expect(verifySession(store, garbage, 1_000_000)).toBe(false);
  }
  expect(verifySession(null, value, 1_000_000)).toBe(false);
  expect(verifySession(emptyStore(), value, 1_000_000)).toBe(false); // no session_secret
});

test("session secret minted once and stable", () => {
  const root = tempDir();
  createToken(root);
  const first = loadAuth(root)!.sessionSecret;
  expect(first.length).toBe(64); // hex32
  setPassword(root, "salasana");
  expect(loadAuth(root)!.sessionSecret).toBe(first); // stable across saves
});

test("auth active semantics", () => {
  expect(authActive(null)).toBe(false);
  expect(authActive(emptyStore())).toBe(false);
  expect(authActive({ ...emptyStore(), tokens: [{ id: "tk_x" } as never] })).toBe(true);
  expect(authActive({ ...emptyStore(), password: { algo: "scrypt", salt: "", hash: "" } })).toBe(true);
  expect(authActive({ ...emptyStore(), corrupt: true })).toBe(true); // unreadable fails closed
  // a fully emptied store (all tokens revoked, password cleared) opens back up
  const root = tempDir();
  const [tokenId] = createToken(root);
  revokeToken(root, tokenId);
  expect(authActive(loadAuth(root))).toBe(false);
});

test("load auth absent and corrupt", () => {
  const root = tempDir();
  expect(loadAuth(root)).toBeNull();
  writeFileSync(authPath(root), "not json {", "utf8");
  expect(() => loadAuth(root)).toThrow(/not valid JSON/);
});

test.skipIf(process.platform === "win32")("auth file is owner only", () => {
  const root = tempDir();
  createToken(root);
  const mode = statSync(authPath(root)).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("provider reloads on change", () => {
  const root = tempDir();
  const provider = new AuthProvider(root);
  expect(provider.current()).toBeNull();
  const [tokenId, secret] = createToken(root);
  expect(verifyToken(provider.current(), secret)).toBe(true); // picked up without a restart
  revokeToken(root, tokenId);
  expect(verifyToken(provider.current(), secret)).toBe(false);
  writeFileSync(authPath(root), "broken {", "utf8");
  expect(provider.current()!.corrupt).toBe(true); // fail closed, never silently open
});

test("ensure gitignored appends once", () => {
  const base = tempDir();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const gitignore = join(repo, ".gitignore");
  writeFileSync(gitignore, "node_modules/", "utf8"); // no trailing newline
  const bundle = join(repo, "wiki");
  mkdirSync(bundle);
  expect(ensureGitignored(bundle)).toBe(gitignore);
  expect(readFileSync(gitignore, "utf8")).toBe(`node_modules/\n${AUTH_FILE}\n`);
  expect(ensureGitignored(bundle)).toBeNull(); // idempotent
  expect(readFileSync(gitignore, "utf8")).toBe(`node_modules/\n${AUTH_FILE}\n`);
});

test("ensure gitignored without repo or file", () => {
  const base = tempDir();
  const lone = join(base, "lone");
  mkdirSync(lone);
  expect(ensureGitignored(lone)).toBeNull();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  expect(ensureGitignored(repo)).toBeNull(); // a repo without .gitignore is left alone
});

// -- CLI runners (spec/80): the secret prints once, list never leaks, revoke bites ----

test("cli token create prints the secret once", () => {
  const root = tempDir();
  const out = capture();
  expect(runTokenCreate(root, { name: "hermes", print: out.print })).toBe(0);
  const text = out.text();
  expect(text).toContain("token created: tk_");
  expect(text).toContain("(hermes)");
  expect(text).toContain("store it now");
  const secretsShown = text.split(/\s+/).filter((word) => word.startsWith("bp_"));
  expect(secretsShown.length).toBe(1); // shown exactly once, right here
  expect(verifyToken(loadAuth(root), secretsShown[0]!)).toBe(true);
});

test("cli token list never prints secrets", () => {
  const root = tempDir();
  const empty = capture();
  expect(runTokenList(root, { print: empty.print })).toBe(0);
  expect(empty.text()).toContain("no tokens yet");
  runTokenCreate(root, { name: "hermes", print: () => undefined });
  const out = capture();
  expect(runTokenList(root, { print: out.print })).toBe(0);
  const text = out.text();
  expect(text).toContain("tk_");
  expect(text).toContain("hermes");
  expect(text).not.toContain("bp_"); // ids and names — never secrets
});

test("cli token revoke", () => {
  const root = tempDir();
  runTokenCreate(root, { name: "hermes", print: () => undefined });
  const tokenId = listTokens(root)[0]!.id;
  const out = capture();
  expect(runTokenRevoke(root, tokenId, { print: out.print })).toBe(0);
  expect(out.text()).toContain("revoked");
  const again = capture();
  expect(runTokenRevoke(root, tokenId, { print: again.print })).toBe(1);
  expect(again.text()).toContain("token list shows the ids");
});

test("cli password set and clear", () => {
  const root = tempDir();
  const out = capture();
  expect(runPasswordSetValue(root, "kotiaurinko", { print: out.print })).toBe(0);
  expect(out.text()).toContain("password set");
  expect(verifyPassword(loadAuth(root), "kotiaurinko")).toBe(true);

  const rejected = capture();
  expect(runPasswordSetValue(root, "", { print: rejected.print })).toBe(1);
  expect(rejected.text()).toContain("cannot be empty");

  const cleared = capture();
  expect(runPasswordClear(root, { print: cleared.print })).toBe(0);
  expect(cleared.text()).toContain("password cleared");
  expect(loadAuth(root)!.password).toBeNull();
  const nothing = capture();
  expect(runPasswordClear(root, { print: nothing.print })).toBe(0);
  expect(nothing.text()).toContain("nothing to clear");
});

test("cli auth commands teach the repo gitignore", () => {
  const base = tempDir();
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".brainpick/\n", "utf8");
  const bundle = join(repo, "wiki");
  mkdirSync(bundle);
  const out = capture();
  expect(runTokenCreate(bundle, { print: out.print })).toBe(0);
  expect(out.text()).toContain(".brainpick-auth.json added");
  const text = readFileSync(join(repo, ".gitignore"), "utf8");
  expect(text).toBe(".brainpick/\n.brainpick-auth.json\n");
  runTokenList(bundle, { print: () => undefined }); // every auth command checks — once is enough
  expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(text);
});
