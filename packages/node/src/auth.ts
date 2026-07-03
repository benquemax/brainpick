/** Optional auth (spec/80): salted scrypt tokens + a password in .brainpick-auth.json.
 *
 * Secrets never live in config or .brainpick/ — artifacts are disposable and
 * henxels hunts secrets. The file sits at the bundle root, holds salted hashes
 * only (scrypt N=16384 r=8 p=1, 32-byte key, 16-byte salt — identical in both
 * engines), is written 0600, and every CLI command that touches it teaches the
 * repo .gitignore the filename. Open-by-default stays first-class: no file, no
 * gate — and stdio MCP is never gated, it is local by construction.
 * Ports brainpick/auth.py.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { loadConfig } from "./config";
import { findRepoRoot } from "./detect";

export const AUTH_FILE = ".brainpick-auth.json";

export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEY_LEN = 32;
export const SCRYPT_SALT_LEN = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024; // headroom over the 16 MiB the parameters need

export const SESSION_COOKIE = "bp_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // spec/80: sessions expire after 12 h

export const AUTH_REQUIRED_ERROR =
  "authentication required — send Authorization: Bearer <token> " +
  "(create one: brainpick token create) or log in";
export const CORRUPT_AUTH_ERROR = `${AUTH_FILE} is not valid JSON — fix or delete it, then rerun`;

// The password gate for humans (spec/50): dark, on-brand, zero dependencies —
// it must render even when the auth gate withholds every other static asset.
export const LOGIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>brainpick — log in</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #04060c; color: #eaf6ff; font-family: system-ui, sans-serif; }
  form { width: min(20rem, 90vw); padding: 2rem; border: 1px solid rgba(75, 225, 255, 0.25);
         border-radius: 0.75rem; background: rgba(12, 20, 36, 0.55); text-align: center; }
  .mark { color: #4be1ff; letter-spacing: 0.2em; margin-bottom: 0.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
  p { color: #8ba3bd; font-size: 0.85rem; margin: 0 0 1.25rem; }
  input { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; margin-bottom: 0.75rem;
          border: 1px solid rgba(75, 225, 255, 0.35); border-radius: 0.5rem;
          background: rgba(4, 8, 16, 0.85); color: #eaf6ff; font-size: 1rem; }
  button { width: 100%; padding: 0.6rem; border: 0; border-radius: 0.5rem; background: #4be1ff;
           color: #04060c; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .error { color: #ff6b7a; margin: 0.75rem 0 0; display: none; }
</style></head>
<body>
<form id="login">
  <div class="mark">◉ ─── ◉ ─── ◉</div>
  <h1>brainpick</h1>
  <p>this brain asks for a password</p>
  <input type="password" name="password" placeholder="password" autocomplete="current-password" autofocus>
  <button type="submit">log in</button>
  <p class="error">wrong password — try again</p>
</form>
<script>
document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = event.target.elements.password.value;
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (response.status === 204) { location.reload(); return; }
  document.querySelector(".error").style.display = "block";
});
</script>
</body></html>
`;

export interface HashRecord {
  algo: string;
  salt: string;
  hash: string;
}

export interface TokenRecord extends HashRecord {
  id: string;
  name: string | null;
  created: string;
}

export interface AuthStore {
  tokens: TokenRecord[];
  password: HashRecord | null;
  sessionSecret: string;
  corrupt: boolean; // unreadable file → fail closed, never silently open
}

export function emptyStore(): AuthStore {
  return { tokens: [], password: null, sessionSecret: "", corrupt: false };
}

export function authPath(root: string): string {
  return join(root, AUTH_FILE);
}

/** The one KDF both engines share — parameters are part of the spec (spec/80). */
export function scryptHash(secret: string, salt: Buffer): Buffer {
  return scryptSync(Buffer.from(secret, "utf8"), salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

function hashRecord(secret: string): HashRecord {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  return { algo: "scrypt", salt: salt.toString("hex"), hash: scryptHash(secret, salt).toString("hex") };
}

function hexToBuffer(hex: string): Buffer | null {
  if (!/^([0-9a-fA-F]{2})+$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

function verifyHash(secret: string, record: unknown): boolean {
  if (typeof record !== "object" || record === null) return false;
  const { algo, salt, hash } = record as Partial<HashRecord>;
  if (algo !== "scrypt" || typeof salt !== "string" || typeof hash !== "string") return false;
  const saltBytes = hexToBuffer(salt);
  const expected = hexToBuffer(hash);
  if (saltBytes === null || saltBytes.length === 0 || expected === null) return false;
  if (expected.length !== SCRYPT_KEY_LEN) return false;
  return timingSafeEqual(scryptHash(secret, saltBytes), expected);
}

/** null when the file is absent (open); throws when it is corrupt. */
export function loadAuth(root: string): AuthStore | null {
  const path = authPath(root);
  let text: string;
  try {
    if (!statSync(path).isFile()) return null;
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(CORRUPT_AUTH_ERROR);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(CORRUPT_AUTH_ERROR);
  }
  const record = data as Record<string, unknown>;
  const tokens = record["tokens"] ?? [];
  const password = record["password"] ?? null;
  if (!Array.isArray(tokens) || (password !== null && (typeof password !== "object" || Array.isArray(password)))) {
    throw new Error(CORRUPT_AUTH_ERROR);
  }
  return {
    tokens: tokens.filter((t): t is TokenRecord => typeof t === "object" && t !== null && !Array.isArray(t)),
    password: password as HashRecord | null,
    sessionSecret: String(record["session_secret"] ?? ""),
    corrupt: false,
  };
}

/** Atomic write, 0600 where meaningful (a no-op on Windows). */
function atomicWriteSecret(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.bp-tmp-${randomBytes(8).toString("hex")}`);
  try {
    writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
    if (process.platform !== "win32") chmodSync(path, 0o600);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw err;
  }
}

/** session_secret is minted on first save (spec/80). */
export function saveAuth(root: string, store: AuthStore): void {
  if (!store.sessionSecret) store.sessionSecret = randomBytes(32).toString("hex");
  const data: Record<string, unknown> = { version: 1 };
  if (store.password !== null) data["password"] = store.password;
  data["tokens"] = store.tokens;
  data["session_secret"] = store.sessionSecret;
  atomicWriteSecret(authPath(root), JSON.stringify(data, null, 2) + "\n");
}

/** Enforcement switches on once tokens or a password exist (spec/80). */
export function authActive(store: AuthStore | null): boolean {
  return store !== null && (store.corrupt || store.tokens.length > 0 || store.password !== null);
}

function loadOrNew(root: string): AuthStore {
  return loadAuth(root) ?? emptyStore();
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Mint a token; returns [id, secret] — the secret is shown once, never stored. */
export function createToken(root: string, name: string | null = null): [string, string] {
  const store = loadOrNew(root);
  const secret = "bp_" + randomBytes(16).toString("hex");
  const existing = new Set(store.tokens.map((record) => record.id));
  let tokenId = "tk_" + randomBytes(4).toString("hex");
  while (existing.has(tokenId)) tokenId = "tk_" + randomBytes(4).toString("hex"); // 4-byte collision
  store.tokens.push({ id: tokenId, name, ...hashRecord(secret), created: utcNowIso() });
  saveAuth(root, store);
  return [tokenId, secret];
}

export function listTokens(root: string): TokenRecord[] {
  const store = loadAuth(root);
  return store !== null ? [...store.tokens] : [];
}

export function revokeToken(root: string, tokenId: string): boolean {
  const store = loadAuth(root);
  if (store === null) return false;
  const kept = store.tokens.filter((record) => record.id !== tokenId);
  if (kept.length === store.tokens.length) return false;
  store.tokens = kept;
  saveAuth(root, store);
  return true;
}

export function setPassword(root: string, password: string): void {
  const store = loadOrNew(root);
  store.password = hashRecord(password);
  saveAuth(root, store);
}

export function clearPassword(root: string): boolean {
  const store = loadAuth(root);
  if (store === null || store.password === null) return false;
  store.password = null;
  saveAuth(root, store);
  return true;
}

/** True when the secret matches any stored token hash. */
export function verifyToken(store: AuthStore | null, secret: string): boolean {
  if (store === null || secret === "") return false;
  return store.tokens.some((record) => verifyHash(secret, record));
}

export function verifyPassword(store: AuthStore | null, password: string): boolean {
  if (store === null || store.password === null || typeof password !== "string") return false;
  return verifyHash(password, store.password);
}

// -- sessions (HMAC-signed cookie, no server-side state) -----------------------------

function sessionMac(sessionSecret: string, expiry: number): string {
  const key = Buffer.from(sessionSecret, "hex");
  return createHmac("sha256", key).update(String(expiry), "ascii").digest("hex");
}

/** `<expiry>.<hexmac>` — expiry is unix seconds, MAC is HMAC-SHA256(session_secret). */
export function makeSessionCookie(store: AuthStore, now: number | null = null): string {
  if (!store.sessionSecret) throw new Error("the auth store has no session_secret — save it once first");
  const expiry = Math.trunc(now ?? Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${expiry}.${sessionMac(store.sessionSecret, expiry)}`;
}

export function verifySession(store: AuthStore | null, value: string, now: number | null = null): boolean {
  if (store === null || !store.sessionSecret || value === "") return false;
  const cut = value.indexOf(".");
  if (cut === -1) return false;
  const expiryText = value.slice(0, cut);
  const mac = value.slice(cut + 1);
  if (!/^\d+$/.test(expiryText)) return false;
  const expiry = parseInt(expiryText, 10);
  if (expiry <= Math.trunc(now ?? Date.now() / 1000)) return false;
  const expected = Buffer.from(sessionMac(store.sessionSecret, expiry), "utf8");
  const provided = Buffer.from(mac, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function sessionCookieHeader(store: AuthStore, now: number | null = null): string {
  const value = makeSessionCookie(store, now);
  return `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

/** Reads .brainpick-auth.json lazily and reloads when the file changes, so
 * token create/revoke takes effect on a running server without a restart. */
export class AuthProvider {
  readonly root: string;
  private sig: string = "unset";
  private store: AuthStore | null = null;

  constructor(root: string) {
    this.root = root;
  }

  current(): AuthStore | null {
    let sig: string;
    try {
      const st = statSync(authPath(this.root), { bigint: true });
      sig = `${st.mtimeNs}:${st.size}`;
    } catch {
      sig = "absent";
    }
    if (sig !== this.sig) {
      this.sig = sig;
      try {
        this.store = loadAuth(this.root);
      } catch {
        this.store = { ...emptyStore(), corrupt: true }; // fail closed, never silently open
      }
    }
    return this.store;
  }
}

// -- gitignore hygiene ----------------------------------------------------------------

/** Append .brainpick-auth.json to the repo .gitignore (when one exists) —
 * secrets must never enter git. Returns the path it edited, or null. */
export function ensureGitignored(root: string): string | null {
  const repo = findRepoRoot(root);
  if (repo === null) return null;
  const gitignore = join(repo, ".gitignore");
  let text: string;
  try {
    if (!statSync(gitignore).isFile()) return null;
    text = readFileSync(gitignore, "utf8");
  } catch {
    return null;
  }
  if (text.includes(AUTH_FILE)) return null;
  const glue = text === "" || text.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignore, text + glue + AUTH_FILE + "\n", "utf8");
  return gitignore;
}

// -- CLI runners (henxels family voice: plain lines, every error an instruction) ------

export type Print = (line: string) => void;
const defaultPrint: Print = (line) => console.log(line);

/** --root resolved the way serve resolves it: through [bundle] root (spec/80). */
function resolveBundleRoot(root: string): string {
  const resolved = resolve(root);
  const config = loadConfig(resolved);
  return resolve(resolved, config.bundle.root);
}

function noteGitignore(root: string, print: Print): void {
  const path = ensureGitignored(root);
  if (path !== null) print(`gitignore: ${AUTH_FILE} added to ${path} (secrets stay off the record)`);
}

export interface AuthCliOptions {
  name?: string | null;
  print?: Print;
}

export function runTokenCreate(root: string, options: AuthCliOptions = {}): number {
  const print = options.print ?? defaultPrint;
  const name = options.name ?? null;
  const bundle = resolveBundleRoot(root);
  let tokenId: string;
  let secret: string;
  try {
    [tokenId, secret] = createToken(bundle, name);
  } catch (error) {
    print(error instanceof Error ? error.message : String(error));
    return 1;
  }
  print(`token created: ${tokenId} (${name !== null && name !== "" ? name : "unnamed"})`);
  print("");
  print(`  ${secret}`);
  print("");
  print("store it now — only a salted hash is kept; the secret never prints again");
  noteGitignore(bundle, print);
  return 0;
}

export function runTokenList(root: string, options: AuthCliOptions = {}): number {
  const print = options.print ?? defaultPrint;
  const bundle = resolveBundleRoot(root);
  let tokens: TokenRecord[];
  try {
    tokens = listTokens(bundle);
  } catch (error) {
    print(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (tokens.length === 0) print("no tokens yet — mint one: brainpick token create");
  for (const record of tokens) {
    print(`${record.id}  ${record.created}  ${record.name ?? "unnamed"}`);
  }
  noteGitignore(bundle, print);
  return 0;
}

export function runTokenRevoke(root: string, tokenId: string, options: AuthCliOptions = {}): number {
  const print = options.print ?? defaultPrint;
  const bundle = resolveBundleRoot(root);
  let revoked: boolean;
  try {
    revoked = revokeToken(bundle, tokenId);
  } catch (error) {
    print(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!revoked) {
    print(`no token '${tokenId}' here — brainpick token list shows the ids`);
    noteGitignore(bundle, print);
    return 1;
  }
  print(`token ${tokenId} revoked — it stops working immediately`);
  noteGitignore(bundle, print);
  return 0;
}

/** The plumbing behind `password set`: an already-read password lands in the store. */
export function runPasswordSetValue(root: string, password: string, options: AuthCliOptions = {}): number {
  const print = options.print ?? defaultPrint;
  const bundle = resolveBundleRoot(root);
  if (password === "") {
    print("a password cannot be empty — nothing changed");
    return 1;
  }
  try {
    setPassword(bundle, password);
  } catch (error) {
    print(error instanceof Error ? error.message : String(error));
    return 1;
  }
  print("password set — the web UI now asks for it (undo: brainpick password clear)");
  noteGitignore(bundle, print);
  return 0;
}

export function runPasswordClear(root: string, options: AuthCliOptions = {}): number {
  const print = options.print ?? defaultPrint;
  const bundle = resolveBundleRoot(root);
  let cleared: boolean;
  try {
    cleared = clearPassword(bundle);
  } catch (error) {
    print(error instanceof Error ? error.message : String(error));
    return 1;
  }
  print(cleared ? "password cleared — the web UI opens without a login" : "no password was set — nothing to clear");
  noteGitignore(bundle, print);
  return 0;
}

/** Read the first stdin line (pipes: `echo pw | brainpick password set --stdin`). */
export async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const line = text.split("\n")[0] ?? "";
  return line.replace(/[\r\n]+$/, "");
}

/** A masked TTY prompt — python's getpass, hand-rolled (no deps). */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolvePassword, reject) => {
    process.stderr.write(question);
    const stdin = process.stdin;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = (err: Error | null): void => {
      stdin.off("data", onData);
      if (stdin.setRawMode) stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (err !== null) reject(err);
      else resolvePassword(value);
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") return finish(null);
        if (ch === "\u0003") return finish(new Error("interrupted"));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
