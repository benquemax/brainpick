/** ed25519 deploy keys (_todo.md — Tom's decision, no OS keychain):
 * "do what OpenSSH does — key file in app data dir, 0600." A read-only deploy
 * key for a repo already sitting decrypted on the same disk isn't protected
 * by encrypting it, and Linux Secret Service is a desktop-environment
 * lottery — a plain file, scoped one-key-per-brain, is both simpler and
 * exactly as secure as the threat model calls for.
 *
 * Node's own `crypto` generates the keypair — no dependency needed. The
 * private key is exported as a standard PKCS8 PEM; OpenSSH (7.8+, i.e.
 * effectively everything since 2018) reads that directly via `ssh -i`, so
 * there is no need to hand-roll the "OPENSSH PRIVATE KEY" bcrypt-KDF format.
 * The public key, though, has no such shortcut: forges want the SSH wire
 * format (`ssh-ed25519 <base64>`), which is hand-encoded below from the raw
 * 32-byte key — verified byte-identical to `ssh-keygen -y`'s own output. */
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dataDir, type Env } from "./paths";

export interface BrainKey {
  /** `ssh-ed25519 AAAA...` — paste-able into a forge's deploy-key settings. */
  publicKey: string;
  privateKeyPath: string;
}

export function keyDir(id: string, env: Env = process.env): string {
  return join(dataDir(env), "keys", id);
}

/** The SSH wire-format public key blob (RFC 4253 §6.6): length-prefixed
 * "ssh-ed25519" followed by the length-prefixed raw 32-byte key, base64'd. */
function sshEd25519Line(rawPublicKey: Uint8Array): string {
  const type = Buffer.from("ssh-ed25519");
  const key = Buffer.from(rawPublicKey);
  const parts: Buffer[] = [];
  for (const buf of [type, key]) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(buf.length, 0);
    parts.push(len, buf);
  }
  return `ssh-ed25519 ${Buffer.concat(parts).toString("base64")}`;
}

/** An ed25519 SPKI DER encoding is fixed-size (44 bytes: a constant 12-byte
 * AlgorithmIdentifier + BIT STRING header + the 32-byte raw key) — the last
 * 32 bytes are always the raw public key, no ASN.1 parser needed. */
function rawPublicKeyFrom(der: Uint8Array): Uint8Array {
  return der.subarray(der.length - 32);
}

/** Generate (once) and return the brain's deploy keypair. Idempotent: an
 * existing key is read back and returned unchanged — re-running `init` (or
 * any wizard retry) never mints a second key for the same brain, so the
 * pubkey already pasted into a forge keeps working. */
export function ensureBrainKey(id: string, env: Env = process.env): BrainKey {
  const dir = keyDir(id, env);
  const privateKeyPath = join(dir, "id_ed25519");
  const publicKeyPath = `${privateKeyPath}.pub`;

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    return { publicKey: readFileSync(publicKeyPath, "utf8").trim(), privateKeyPath };
  }

  mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  const line = sshEd25519Line(rawPublicKeyFrom(der));

  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  writeFileSync(privateKeyPath, pem, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(privateKeyPath, 0o600);
  writeFileSync(publicKeyPath, `${line}\n`, "utf8");

  return { publicKey: line, privateKeyPath };
}
