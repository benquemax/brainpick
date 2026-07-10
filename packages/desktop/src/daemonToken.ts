/** The daemon's own control-API token (_todo.md): generated on first
 * run, stored in the config dir, shown by `brainpickd token`. Gates every
 * `/daemon/*` route — a single bearer secret for the whole control API,
 * separate from both per-brain engine tokens (users.ts provisioning, which
 * gate a BRAIN's own /api and /mcp) and per-user passwords. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { configDir, type Env } from "./paths";

export const DAEMON_TOKEN_FILE = "token";

export function daemonTokenPath(env: Env = process.env): string {
  return `${configDir(env)}/${DAEMON_TOKEN_FILE}`;
}

/** Read-only — never mints a token as a side effect (verification must not
 * silently rotate the secret out from under a client mid-request). */
export function loadDaemonToken(env: Env = process.env): string | null {
  try {
    return readFileSync(daemonTokenPath(env), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Get-or-create: the ONE place a token is minted, called once at daemon
 * startup (and by `brainpickd token`, which only ever wants to show it). */
export function ensureDaemonToken(env: Env = process.env): string {
  const existing = loadDaemonToken(env);
  if (existing !== null) return existing;

  const token = "bpd_" + randomBytes(24).toString("hex");
  const path = daemonTokenPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return token;
}

export function verifyDaemonToken(candidate: string, env: Env = process.env): boolean {
  const expected = loadDaemonToken(env);
  if (expected === null || candidate === "") return false;
  const expectedBuf = Buffer.from(expected);
  const candidateBuf = Buffer.from(candidate);
  return expectedBuf.length === candidateBuf.length && timingSafeEqual(expectedBuf, candidateBuf);
}
