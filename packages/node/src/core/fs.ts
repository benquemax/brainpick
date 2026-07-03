/** Atomic file writes — temp + rename, so readers never see a torn artifact. */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function atomicWrite(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.bp-tmp-${randomBytes(8).toString("hex")}`);
  try {
    if (typeof data === "string") writeFileSync(tmp, data, "utf8");
    else writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw err;
  }
}

/** Write only when the bytes differ; returns whether anything changed on disk. */
export function writeIfChanged(path: string, text: string): boolean {
  const data = Buffer.from(text, "utf8");
  try {
    if (statSync(path).isFile() && readFileSync(path).equals(data)) return false;
  } catch {
    /* missing — write below */
  }
  atomicWrite(path, data);
  return true;
}

/** Python's `Path.read_text(encoding="utf-8")` — including text mode's
 * universal-newline translation, which the byte comparisons depend on. */
export function readTextOrNull(path: string): string | null {
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
