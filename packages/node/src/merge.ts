/** Merge resolution for stale writes (spec/70 brain_write `base_sha`). Port of
 * merge.py, byte-faithful.
 *
 * The proposal ladder: a mechanical three-way merge when the base is known and
 * the edits do not overlap; a single-shot merge through the configured
 * [models.extraction] chat model when they do (prose merges badly mechanically —
 * the model the brain already has doubles as the merge tool); neither → null,
 * the manual path. Every product here is a PROPOSAL — callers never auto-apply.
 */
import { spawnSync } from "node:child_process";

import { sha256Hex } from "./core/canonical";
import { SequenceMatcher } from "./core/difflib";
import { splitFrontmatter } from "./core/frontmatter";
import { pySplitLinesKeepends, pyStrip } from "./core/pyfmt";
import { which } from "./detect";
import { ChatUnavailable, type ChatClient } from "./llm";

const CONFLICT_MARKER = /^(<{7}|>{7}|={7})/m;
const FENCE_WRAP = /^```[a-zA-Z]*\n([\s\S]*)\n```\s*$/;

export const MERGE_SYSTEM =
  "You are merging two edits of the same markdown knowledge page. " +
  "Preserve BOTH parties' new information; where both rewrote the same passage, combine them. " +
  "Keep the YAML frontmatter intact and valid. " +
  "Output ONLY the merged markdown document — no commentary, no code fences, no conflict markers.";

export const MERGE_USER =
  "--- BASE (the version both edits started from) ---\n{base}\n" +
  "--- THEIRS (the currently saved version) ---\n{theirs}\n" +
  "--- YOURS (the incoming edit) ---\n{yours}";

export const MERGE_SYSTEM_TWO =
  "You are merging two divergent versions of the same markdown knowledge page; " +
  "no common ancestor is available. " +
  "Preserve BOTH versions' information, deduplicating what they share. " +
  "Keep the YAML frontmatter intact and valid. " +
  "Output ONLY the merged markdown document — no commentary, no code fences, no conflict markers.";

export const MERGE_USER_TWO =
  "--- THEIRS (the currently saved version) ---\n{theirs}\n" +
  "--- YOURS (the incoming edit) ---\n{yours}";

export interface MergeProposal {
  content: string;
  strategy: "three-way" | "llm";
}

/** Single-pass named substitution — Python `str.format` over the merge templates:
 * only `{name}` tokens in the TEMPLATE are replaced (never braces inside a value),
 * and the returned value is inserted literally (no `$`-pattern interpretation). */
function pyFormat(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(fields, name) ? fields[name]! : whole,
  );
}

function extend(target: string[], more: readonly string[]): void {
  for (const item of more) target.push(item);
}

// -- three-way (mechanical) ------------------------------------------------------------

function matchingBlocks(base: string[], other: string[]): Array<{ a: number; b: number; size: number }> {
  const sm = new SequenceMatcher("", "", false); // autojunk=False, like merge.py
  sm.setElementSeqs(base, other);
  return sm.getMatchingBlocks();
}

/** Base intervals matched by BOTH sides, with their positions in each side:
 * [base_lo, base_hi, a_lo, a_hi, b_lo, b_hi], ascending and non-overlapping. */
function syncRegions(
  base: string[],
  a: string[],
  b: string[],
): Array<[number, number, number, number, number, number]> {
  const am = matchingBlocks(base, a);
  const bm = matchingBlocks(base, b);
  const regions: Array<[number, number, number, number, number, number]> = [];
  let ai = 0;
  let bi = 0;
  while (ai < am.length && bi < bm.length) {
    const blkA = am[ai]!;
    const blkB = bm[bi]!;
    const lo = Math.max(blkA.a, blkB.a);
    const hi = Math.min(blkA.a + blkA.size, blkB.a + blkB.size);
    if (lo < hi) {
      regions.push([
        lo,
        hi,
        blkA.b + lo - blkA.a,
        blkA.b + hi - blkA.a,
        blkB.b + lo - blkB.a,
        blkB.b + hi - blkB.a,
      ]);
    }
    if (blkA.a + blkA.size <= blkB.a + blkB.size) ai += 1;
    else bi += 1;
  }
  return regions;
}

function arraysEqual(x: readonly string[], y: readonly string[]): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Mechanical line merge; null when the edits overlap.
 *
 * Conservative on purpose: a stable region of blank lines does not separate two
 * edits — a heading rename and an edit to the paragraph under it are the same
 * neighborhood, and in doubt the answer is null (the ladder's next rung). */
export function threeWay(base: string, theirs: string, yours: string): string | null {
  if (theirs === yours) return theirs;
  const baseL = pySplitLinesKeepends(base);
  const theirsL = pySplitLinesKeepends(theirs);
  const yoursL = pySplitLinesKeepends(yours);

  const out: string[] = [];
  let bpos = 0;
  let tpos = 0;
  let ypos = 0;

  /** Resolve one gap between sync regions; false when both sides edited it. */
  const flush = (blo: number, tlo: number, ylo: number): boolean => {
    const baseGap = baseL.slice(bpos, blo);
    const theirsGap = theirsL.slice(tpos, tlo);
    const yoursGap = yoursL.slice(ypos, ylo);
    if (arraysEqual(theirsGap, baseGap)) {
      extend(out, yoursGap); // only yours (or nobody) touched it
    } else if (arraysEqual(yoursGap, baseGap) || arraysEqual(yoursGap, theirsGap)) {
      extend(out, theirsGap); // only theirs touched it, or both agree
    } else {
      return false;
    }
    return true;
  };

  for (const [blo, bhi, tlo, thi, ylo, yhi] of syncRegions(baseL, theirsL, yoursL)) {
    if (!baseL.slice(blo, bhi).some((line) => pyStrip(line) !== "")) continue; // blank-only stability
    if (!flush(blo, tlo, ylo)) return null;
    extend(out, baseL.slice(blo, bhi));
    bpos = bhi;
    tpos = thi;
    ypos = yhi;
  }
  if (!flush(baseL.length, theirsL.length, yoursL.length)) return null;
  return out.join("");
}

// -- llm (single-shot) -------------------------------------------------------------------

/** The sanity gate on model output: non-empty, unfenced, no conflict markers,
 * frontmatter still parses (splitFrontmatter) when the inputs carried one. */
function sanitize(answer: string, theirs: string, yours: string): string | null {
  let text = pyStrip(answer);
  const fenced = FENCE_WRAP.exec(text);
  if (fenced) text = pyStrip(fenced[1]!);
  if (!text) return null;
  if (CONFLICT_MARKER.test(text)) return null;
  if (!text.endsWith("\n")) text += "\n";
  if (theirs.startsWith("---\n") || yours.startsWith("---\n")) {
    const [meta] = splitFrontmatter(text);
    if (Object.keys(meta).length === 0) return null; // inputs had frontmatter; the merge lost or broke it
  }
  return text;
}

async function ask(
  chat: ChatClient,
  system: string,
  user: string,
  theirs: string,
  yours: string,
): Promise<string | null> {
  let answer: string;
  try {
    answer = await chat.complete(system, user);
  } catch (error) {
    if (error instanceof ChatUnavailable) return null;
    throw error;
  }
  return sanitize(answer, theirs, yours);
}

/** One shot through the extraction model with the full triple; null unless sane. */
export async function llmMerge(
  base: string,
  theirs: string,
  yours: string,
  chat: ChatClient,
): Promise<string | null> {
  const user = pyFormat(MERGE_USER, { base, theirs, yours });
  return ask(chat, MERGE_SYSTEM, user, theirs, yours);
}

/** The degraded, honest variant when no base exists: the prompt says so. */
export async function llmMergeTwo(theirs: string, yours: string, chat: ChatClient): Promise<string | null> {
  const user = pyFormat(MERGE_USER_TWO, { theirs, yours });
  return ask(chat, MERGE_SYSTEM_TWO, user, theirs, yours);
}

// -- the ladder ---------------------------------------------------------------------------

/** spec/70's proposal ladder → {content, strategy} or null (manual path). */
export async function resolve(
  base: string | null,
  theirs: string,
  yours: string,
  chat: ChatClient | null,
): Promise<MergeProposal | null> {
  if (base !== null) {
    const merged = threeWay(base, theirs, yours);
    if (merged !== null) return { content: merged, strategy: "three-way" };
    if (chat !== null) {
      const llm = await llmMerge(base, theirs, yours, chat);
      if (llm !== null) return { content: llm, strategy: "llm" };
    }
    return null;
  }
  if (chat === null) return null;
  const llm = await llmMergeTwo(theirs, yours, chat);
  if (llm !== null) return { content: llm, strategy: "llm" };
  return null;
}

// -- where the base comes from -------------------------------------------------------------

/** `git show HEAD:./<rel>` — the committed bytes, or null (no git, not a repo,
 * never committed). The `./` scopes the path to the bundle root even when the
 * bundle is a subdirectory of the repository. */
export function gitBase(root: string, rel: string): Buffer | null {
  const git = which("git");
  if (git === null) return null;
  const proc = spawnSync(git, ["-C", root, "show", `HEAD:./${rel}`], {
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error !== undefined || proc.status !== 0) return null;
  const out = proc.stdout;
  return out === null || out === undefined ? null : Buffer.isBuffer(out) ? out : Buffer.from(out);
}

/** The content the writer read — git HEAD, but only when its bytes hash to
 * `baseSha`. A guessed base would let the mechanical merge silently drop edits;
 * unverified means unknown, and the ladder degrades to the two-input model
 * merge instead. */
export function findBase(root: string, rel: string, baseSha: string): string | null {
  const committed = gitBase(root, rel);
  if (committed === null || sha256Hex(committed) !== baseSha) return null;
  return committed.toString("utf8");
}
