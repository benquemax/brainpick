/**
 * Half-life (spec/50 *Half-life*): memories fade, and that is a feature. A
 * document's retrieval score is multiplied by max(2^(-age/half_life), 1/16) —
 * never deleted, never filtered, only harder to recall — where the effective
 * half-life resolves bundle default → longest matching folder → the doc's own
 * frontmatter `half_life`. Twin of packages/python/src/brainpick/query/half_life.py.
 */
import type { DocRecord } from "../compile/t1";
import type { HalfLifeConfig } from "../config";
import { cmpStr } from "../core/canonical";
import type { SearchHit } from "./keyword";

/** Python round(x, n) — ties at the last digit are unobservable here. */
function pyRound(x: number, digits: number): number {
  return Number(x.toFixed(digits));
}

export const FLOOR = 1 / 16; // four half-lives: a faded page stays recallable, old pages stay ordered

export interface Faded {
  age_days: number;
  half_life: number;
}

export type FadedHit = SearchHit & { faded?: Faded };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** Days; most specific wins. `0` means the document never fades. */
export function effectiveHalfLife(path: string, frontmatter: number | null, config: HalfLifeConfig): number {
  if (frontmatter !== null && frontmatter !== undefined) return Math.max(0, frontmatter);
  let best: [number, number] | null = null;
  for (const [folder, days] of Object.entries(config.folders)) {
    if (!folder) continue;
    if (path === folder || path.startsWith(folder + "/")) {
      if (best === null || folder.length > best[0]) best = [folder.length, days];
    }
  }
  if (best !== null) return Math.max(0, best[1]);
  return Math.max(0, config.default);
}

function validDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number | null {
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== hh ||
    check.getUTCMinutes() !== mm ||
    check.getUTCSeconds() !== ss
  ) {
    return null;
  }
  return ms;
}

/** An OKF timestamp as epoch milliseconds (UTC) — `YYYY-MM-DD` (midnight UTC) or
 * `YYYY-MM-DDTHH:MM[:SS]` with `Z`, an offset, or nothing (naive = UTC); anything
 * else is null (the doc never fades). */
export function parseTimestamp(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  let match = DATE.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = DATETIME.exec(text);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, tz] = match;
  let ms = validDate(Number(y), Number(m), Number(d), Number(hh), Number(mm), Number(ss ?? 0));
  if (ms === null) return null;
  if (tz && tz !== "Z") {
    const sign = tz[0] === "+" ? 1 : -1;
    const offsetMinutes = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)));
    ms -= offsetMinutes * 60_000;
  }
  return ms;
}

/** Days from the document's timestamp to `now`; the future counts as 0. */
export function ageDays(timestamp: string | null, now: Date): number | null {
  const ms = parseTimestamp(timestamp);
  if (ms === null) return null;
  return Math.max(0, (now.getTime() - ms) / 86_400_000);
}

export function fadeFactor(age: number | null, halfLife: number): number {
  if (age === null || halfLife <= 0) return 1;
  return Math.max(Math.pow(2, -age / halfLife), FLOOR);
}

function nothingFades(config: HalfLifeConfig, records: readonly DocRecord[]): boolean {
  return (
    config.default <= 0 &&
    !Object.values(config.folders).some((d) => d > 0) &&
    !records.some((r) => r.half_life !== null && r.half_life !== undefined && r.half_life > 0)
  );
}

/** The retriever's hits with faded scores, re-ranked by (score desc, path).
 * With no config, or a config where nothing fades, the hits come back as they
 * were — byte-identical to an engine without the factor. */
export function fade(
  hits: SearchHit[],
  records: readonly DocRecord[],
  config: HalfLifeConfig | null | undefined,
  now: Date | null | undefined,
): FadedHit[] {
  if (!config || nothingFades(config, records)) return hits;
  const moment = now ?? new Date();
  const byPath = new Map(records.map((r) => [r.path, r]));
  const faded: FadedHit[] = [];
  for (const hit of hits) {
    const record = byPath.get(hit.path);
    if (!record) {
      faded.push(hit);
      continue;
    }
    const halfLife = effectiveHalfLife(record.path, record.half_life ?? null, config);
    const age = ageDays(record.timestamp, moment);
    const factor = fadeFactor(age, halfLife);
    if (factor >= 1) {
      faded.push(hit);
      continue;
    }
    faded.push({
      ...hit,
      score: pyRound(hit.score * factor, 6),
      faded: { age_days: pyRound(age ?? 0, 2), half_life: halfLife },
    });
  }
  faded.sort((a, b) => b.score - a.score || cmpStr(a.path, b.path));
  return faded;
}
