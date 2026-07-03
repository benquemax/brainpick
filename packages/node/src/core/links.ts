/** Link extraction from markdown bodies (spec/20: fenced and inline code excluded). */
import { PY_SPACE_CLASS, pyStrip } from "./pyfmt";

// Ports of the Python regexes. `.` under DOTALL ≡ the JS `s` flag; the plain
// `.` in _H1 lives in bundle.ts as [^\n] (Python's non-DOTALL dot); `\s`
// becomes the explicit Python whitespace class (JS \s differs at the edges).
const FENCE = /^```.*?^```[ \t]*$/gms;
const INLINE_CODE = /`[^`\n]*`/g;
const MD_LINK = new RegExp(`(?<!!)\\[([^\\]]*)\\]\\(([^)${PY_SPACE_CLASS}]+)\\)`, "gu");
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export interface RawLink {
  kind: "link" | "wikilink";
  target: string;
  text: string;
}

export function extractLinks(body: string): RawLink[] {
  const scrubbed = body.replace(FENCE, "").replace(INLINE_CODE, "");

  const found: Array<{ start: number; link: RawLink }> = [];
  for (const m of scrubbed.matchAll(WIKILINK)) {
    const target = pyStrip(m[1]!);
    const text = pyStrip(m[2] ?? m[1]!);
    if (target) found.push({ start: m.index, link: { kind: "wikilink", target, text } });
  }
  for (const m of scrubbed.matchAll(MD_LINK)) {
    const target = m[2]!.split("#")[0]!;
    if (!target || SCHEME.test(target)) continue;
    found.push({ start: m.index, link: { kind: "link", target, text: m[1]! } });
  }

  found.sort((a, b) => a.start - b.start); // stable, like Python's sort
  return found.map((f) => f.link);
}
