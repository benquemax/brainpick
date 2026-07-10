/** users.toml (_todo.md): the daemon's own user list — under the
 * hood, no UI yet. First run bootstraps ONE passwordless user "local" with
 * "*" (every brain) access, persisted immediately so every subsequent load
 * sees the same stable id — cross-device account linking later needs that id to
 * never change under a user's feet. Password hashing reuses the engine's own
 * scrypt record shape (scryptHash from "brainpick") rather than inventing a
 * second hashing scheme in the same codebase.
 *
 * Also owns provisioning: minting/revoking per-brain tokens via the engine's
 * own auth machinery, plus the LAN auto-provisioning cache (D.1, checkpoint
 * log) — a status snippet needs the PLAINTEXT secret, which the engine's own
 * `.brainpick-auth.json` never retains by design (only a hash), so the
 * daemon caches it in its own config dir instead. */
import { createToken, listTokens, revokeToken, scryptHash, type TokenRecord } from "brainpick";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { configDir, type Env } from "./paths";
import { brainBundleRoot, isLocalHost, type BrainRecord } from "./registry";

export const USERS_FILE = "users.toml";
export const DEFAULT_USER_NAME = "local";
export const LAN_TOKENS_FILE = "lan-tokens.toml";

export interface PasswordHash {
  algo: string;
  salt: string;
  hash: string;
}

export interface UserRecord {
  id: string;
  name: string;
  password_hash?: PasswordHash;
  brains: string[] | "*";
}

export interface Users {
  users: UserRecord[];
}

export function usersPath(env: Env = process.env): string {
  return join(configDir(env), USERS_FILE);
}

function isPasswordHash(value: unknown): value is PasswordHash {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["algo"] === "string" && typeof v["salt"] === "string" && typeof v["hash"] === "string";
}

function isUserRecord(value: unknown): value is UserRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["id"] !== "string" || v["id"] === "") return false;
  if (typeof v["name"] !== "string" || v["name"] === "") return false;
  if (v["password_hash"] !== undefined && !isPasswordHash(v["password_hash"])) return false;
  const brains = v["brains"];
  if (brains !== "*" && !(Array.isArray(brains) && brains.every((b) => typeof b === "string"))) return false;
  return true;
}

/** Atomic write (tmp file + rename), matching the registry's convention. */
export function saveUsers(users: Users, env: Env = process.env): void {
  const path = usersPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const text = stringifyToml({ user: users.users as unknown as Record<string, unknown>[] });
  const tmp = join(dirname(path), `.users-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

function bootstrap(env: Env): Users {
  const users: Users = { users: [{ id: randomUUID(), name: DEFAULT_USER_NAME, brains: "*" }] };
  saveUsers(users, env);
  return users;
}

/** Absent file → bootstrap (and persist) the default passwordless "local"
 * user. A malformed `[[user]]` entry is dropped, never fatal. */
export function loadUsers(env: Env = process.env): Users {
  let text: string;
  try {
    text = readFileSync(usersPath(env), "utf8");
  } catch {
    return bootstrap(env);
  }
  let data: unknown;
  try {
    data = parseToml(text);
  } catch {
    return bootstrap(env);
  }
  const raw = (data as Record<string, unknown>)["user"];
  const users = Array.isArray(raw) ? raw.filter(isUserRecord) : [];
  return { users };
}

// -- passwords (scrypt, the engine's own record shape) ---------------------------------

function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16);
  return { algo: "scrypt", salt: salt.toString("hex"), hash: scryptHash(password, salt).toString("hex") };
}

export function setUserPassword(users: Users, id: string, password: string): Users {
  return {
    users: users.users.map((u) => (u.id === id ? { ...u, password_hash: hashPassword(password) } : u)),
  };
}

export function verifyUserPassword(user: UserRecord, password: string): boolean {
  if (user.password_hash === undefined) return false; // passwordless — never "matches"
  const { salt, hash } = user.password_hash;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptHash(password, Buffer.from(salt, "hex"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// -- access + pure collection helpers ---------------------------------------------------

export function hasBrainAccess(user: UserRecord, brainId: string): boolean {
  return user.brains === "*" || user.brains.includes(brainId);
}

export function addUser(users: Users, user: UserRecord): Users {
  return { users: [...users.users, user] };
}

export function removeUser(users: Users, id: string): Users {
  return { users: users.users.filter((u) => u.id !== id) };
}

export function findUser(users: Users, id: string): UserRecord | null {
  return users.users.find((u) => u.id === id) ?? null;
}

// -- provisioning (_todo.md): per-brain access is a bearer token on ----------
// that brain, minted/revoked via the ENGINE's own token machinery — no parallel
// auth system, no token storage here. The user's name tags the token so
// `brainpick token list --root <bundle>` reads like "who has a key to this brain".

/** Mint a bearer token on `brain` for `user` (via the engine's own
 * `.brainpick-auth.json`, spec/80) — the daemon never re-implements auth. */
export function provisionToken(brain: BrainRecord, user: UserRecord, env: Env = process.env): [string, string] {
  return createToken(brainBundleRoot(brain, env), user.name);
}

export function revokeProvisionedToken(brain: BrainRecord, tokenId: string, env: Env = process.env): boolean {
  return revokeToken(brainBundleRoot(brain, env), tokenId);
}

export function listProvisionedTokens(brain: BrainRecord, env: Env = process.env): TokenRecord[] {
  return listTokens(brainBundleRoot(brain, env));
}

/** The user auto-provisioning targets: whoever has `"*"` access, or the
 * first user if nobody does (the bootstrap default always has one). */
export function defaultProvisioningUser(users: Users): UserRecord | null {
  return users.users.find((u) => u.brains === "*") ?? users.users[0] ?? null;
}

// -- LAN auto-provisioning cache: the plaintext secret a status snippet -------------
// embeds, keyed by (brain, user). The engine's own auth store never keeps the
// plaintext (by design, spec/80) — so this is the daemon's own small secret,
// same treatment as its control-API token (daemonToken.ts): a plain file in the
// config dir, never committed, never part of a bundle.

export interface LanToken {
  brain_id: string;
  user_id: string;
  token_id: string;
  secret: string;
}

function lanTokensPath(env: Env): string {
  return join(configDir(env), LAN_TOKENS_FILE);
}

function isLanToken(value: unknown): value is LanToken {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["brain_id"] === "string" &&
    typeof v["user_id"] === "string" &&
    typeof v["token_id"] === "string" &&
    typeof v["secret"] === "string" &&
    v["secret"] !== ""
  );
}

function loadLanTokens(env: Env): LanToken[] {
  let text: string;
  try {
    text = readFileSync(lanTokensPath(env), "utf8");
  } catch {
    return [];
  }
  let data: unknown;
  try {
    data = parseToml(text);
  } catch {
    return [];
  }
  const raw = (data as Record<string, unknown>)["token"];
  return Array.isArray(raw) ? raw.filter(isLanToken) : [];
}

function saveLanTokens(tokens: LanToken[], env: Env): void {
  const path = lanTokensPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const text = stringifyToml({ token: tokens as unknown as Record<string, unknown>[] });
  const tmp = join(dirname(path), `.lan-tokens-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

/** Get-or-mint the (brain, user) LAN token, self-healing: if the cached
 * token was revoked (or the auth store reset) on the engine side, a fresh
 * one is minted and the cache updated — never silently hands back a dead
 * secret. Idempotent otherwise: repeated calls reuse the same secret, so a
 * status snippet stays stable across requests. */
export function ensureLanToken(brain: BrainRecord, user: UserRecord, env: Env = process.env): LanToken {
  const cache = loadLanTokens(env);
  const cached = cache.find((t) => t.brain_id === brain.id && t.user_id === user.id);
  if (cached !== undefined) {
    const stillValid = listProvisionedTokens(brain, env).some((t) => t.id === cached.token_id);
    if (stillValid) return cached;
  }

  const [tokenId, secret] = provisionToken(brain, user, env);
  const fresh: LanToken = { brain_id: brain.id, user_id: user.id, token_id: tokenId, secret };
  saveLanTokens([...cache.filter((t) => t !== cached), fresh], env);
  return fresh;
}

/** The single entry point callers (api.ts, daemon.ts) use: ensures a
 * LAN-bound brain has a live token for the default user, minting one if
 * needed; a local-only brain returns null (nothing needs a token). Safe to
 * call repeatedly — provisioning is idempotent. */
export function ensureLanTokenForBrain(brain: BrainRecord, env: Env = process.env): string | null {
  if (isLocalHost(brain.host)) return null;
  const user = defaultProvisioningUser(loadUsers(env));
  if (user === null) return null; // no users at all — shouldn't happen past bootstrap
  return ensureLanToken(brain, user, env).secret;
}
