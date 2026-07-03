/** A faithful port of CPython's difflib.SequenceMatcher (ratio machinery only)
 * plus get_close_matches — the fuzzy engine behind doc resolution and 404
 * suggestions (spec/50 + spec/70). Ports the reference algorithm exactly so
 * both engines suggest the same paths in the same order:
 *
 * - sequences are compared element-wise by CODE POINT (Python str indexing);
 * - autojunk marks elements occurring in >1% of a b-side ≥ 200 long;
 * - get_close_matches gates on real_quick_ratio → quick_ratio → ratio and
 *   picks the top n via nlargest over (score, word) tuples — score ties break
 *   toward the LARGER word, exactly like tuple comparison in the original.
 */
import { cmpStr } from "./canonical";

function codePoints(s: string): string[] {
  return [...s];
}

function calculateRatio(matches: number, length: number): number {
  if (length) return (2.0 * matches) / length;
  return 1.0;
}

interface Match {
  a: number;
  b: number;
  size: number;
}

export class SequenceMatcher {
  private a: string[] = [];
  private b: string[] = [];
  private b2j = new Map<string, number[]>();
  private bjunk = new Set<string>();
  private fullbcount: Map<string, number> | null = null;
  private matchingBlocks: Match[] | null = null;
  private readonly autojunk: boolean;

  constructor(a = "", b = "", autojunk = true) {
    this.autojunk = autojunk;
    this.setSeqs(a, b);
  }

  setSeqs(a: string, b: string): void {
    this.setSeq2(b);
    this.setSeq1(a);
  }

  setSeq1(a: string): void {
    this.a = codePoints(a);
    this.matchingBlocks = null;
  }

  setSeq2(b: string): void {
    this.b = codePoints(b);
    this.matchingBlocks = null;
    this.fullbcount = null;
    this.chainB();
  }

  private chainB(): void {
    const b = this.b;
    const b2j = new Map<string, number[]>();
    this.b2j = b2j;
    for (let i = 0; i < b.length; i++) {
      const elt = b[i]!;
      let indices = b2j.get(elt);
      if (!indices) b2j.set(elt, (indices = []));
      indices.push(i);
    }
    this.bjunk = new Set(); // no isjunk hook — brainpick never passes one
    const popular = new Set<string>();
    const n = b.length;
    if (this.autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) {
        if (idxs.length > ntest) popular.add(elt);
      }
      for (const elt of popular) b2j.delete(elt);
    }
  }

  findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): Match {
    const { a, b, b2j, bjunk } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;

    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const indices = b2j.get(a[i]!);
      if (indices) {
        for (const j of indices) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }

    while (besti > alo && bestj > blo && !bjunk.has(b[bestj - 1]!) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      !bjunk.has(b[bestj + bestsize]!) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    while (besti > alo && bestj > blo && bjunk.has(b[bestj - 1]!) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      bjunk.has(b[bestj + bestsize]!) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    return { a: besti, b: bestj, size: bestsize };
  }

  getMatchingBlocks(): Match[] {
    if (this.matchingBlocks !== null) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;

    const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
    const matchingBlocks: Match[] = [];
    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      if (x.size) {
        matchingBlocks.push(x);
        if (alo < x.a && blo < x.b) queue.push([alo, x.a, blo, x.b]);
        if (x.a + x.size < ahi && x.b + x.size < bhi) {
          queue.push([x.a + x.size, ahi, x.b + x.size, bhi]);
        }
      }
    }
    matchingBlocks.sort((m, n) => m.a - n.a || m.b - n.b || m.size - n.size);

    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: Match[] = [];
    for (const { a: i2, b: j2, size: k2 } of matchingBlocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
    nonAdjacent.push({ a: la, b: lb, size: 0 });

    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  ratio(): number {
    let matches = 0;
    for (const block of this.getMatchingBlocks()) matches += block.size;
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  quickRatio(): number {
    if (this.fullbcount === null) {
      this.fullbcount = new Map();
      for (const elt of this.b) this.fullbcount.set(elt, (this.fullbcount.get(elt) ?? 0) + 1);
    }
    const fullbcount = this.fullbcount;
    const avail = new Map<string, number>();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt) ? avail.get(elt)! : (fullbcount.get(elt) ?? 0);
      avail.set(elt, numb - 1);
      if (numb > 0) matches += 1;
    }
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  realQuickRatio(): number {
    const la = this.a.length;
    const lb = this.b.length;
    return calculateRatio(Math.min(la, lb), la + lb);
  }
}

/** difflib.get_close_matches: the same gates, the same nlargest tie-break
 * (equal ratios prefer the code-point-larger word). */
export function getCloseMatches(word: string, possibilities: readonly string[], n = 3, cutoff = 0.6): string[] {
  if (!(n > 0)) throw new Error(`n must be > 0: ${n}`);
  if (!(cutoff >= 0.0 && cutoff <= 1.0)) throw new Error(`cutoff must be in [0.0, 1.0]: ${cutoff}`);
  const result: Array<[number, string]> = [];
  const s = new SequenceMatcher();
  s.setSeq2(word);
  for (const x of possibilities) {
    s.setSeq1(x);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff && s.ratio() >= cutoff) {
      result.push([s.ratio(), x]);
    }
  }
  // heapq.nlargest over (score, word) tuples — score desc, then word desc.
  result.sort((p, q) => q[0] - p[0] || cmpStr(q[1], p[1]));
  return result.slice(0, n).map(([, x]) => x);
}
