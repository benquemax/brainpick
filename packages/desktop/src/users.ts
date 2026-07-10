/** users.toml (_todo.md): the daemon's own user list — under the
 * hood, no UI yet. First run bootstraps ONE passwordless user "local" with
 * "*" (every brain) access, persisted immediately so every subsequent load
 * sees the same stable id — cross-device account linking later needs that id to
 * never change under a user's feet. Password hashing reuses the engine's own
 * scrypt record shape (scryptHash from "brainpick") rather than inventing a
 * second hashing scheme in the same codebase. */
import { createToken, listTokens, revokeToken, scryptHash, type TokenRecord } from "brainpick";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { configDir, type Env } from "./paths";
import { brainBundleRoot, type BrainRecord } from "./registry";

export const USERS_FILE = "users.toml";
export const DEFAULT_USER_NAME = "local";

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
