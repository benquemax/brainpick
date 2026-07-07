/**
 * Frontmatter ⇄ form, and full-doc assembly for the guarded write.
 *
 * A doc is YAML frontmatter + a markdown body. GET /api/docs already hands the
 * body and the parsed frontmatter apart; the editor keeps the body in the
 * WYSIWYG and the metadata in a structured form (NOT in the prose). On save the
 * two are re-joined: `serializeDoc` prepends a YAML block to the body markdown.
 *
 * `timestamp` is the server's to manage (spec/50) — the form never shows it —
 * but a fresh one is emitted here so a contracted bundle's henxels bump-on-change
 * rule is satisfied at write time; the engine re-stamps it after the referee passes.
 */

export interface Frontmatter {
  type: string;
  title: string;
  description: string;
  tags: string[];
}

export const EMPTY_FRONTMATTER: Frontmatter = { type: '', title: '', description: '', tags: [] };

/** The OKF concept types henxels sanctions (spec: wiki-conventions). */
export const OKF_TYPES = ['Concept', 'Reference', 'Decision', 'Playbook'] as const;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** Build the form model from a GET /api/docs response (frontmatter + title). */
export function frontmatterFromDoc(data: Record<string, unknown>, fallbackTitle = ''): Frontmatter {
  const rawTags = data.tags;
  const tags = Array.isArray(rawTags) ? rawTags.map(asString).filter((t) => t !== '') : [];
  return {
    type: asString(data.type),
    title: asString(data.title) || fallbackTitle,
    description: asString(data.description),
    tags,
  };
}

/** YAML would misread this plain block scalar — it must be double-quoted. */
function needsQuote(value: string): boolean {
  if (value === '') return true;
  if (/^\s|\s$/.test(value)) return true; // leading / trailing space
  if (/^[-?:!&*#|>@%`"'[\]{},]/.test(value)) return true; // an indicator leads
  if (/:(\s|$)/.test(value)) return true; // "key: value" would look like a mapping
  if (/\s#/.test(value)) return true; // " #" starts a comment
  if (/[\n\r\t]/.test(value)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  if (/^[+-]?(\d[\d_]*\.?\d*([eE][+-]?\d+)?|\.\d+)$/.test(value)) return true; // numeric-looking
  return false;
}

function yamlScalar(value: string, flow = false): string {
  const unsafe = needsQuote(value) || (flow && /[,[\]{}]/.test(value));
  if (!unsafe) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Current time as the engine formats a timestamp (spec/50 _bump_timestamp). */
export function nowTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Assemble the full doc: a YAML frontmatter block (type/title/description, tags
 * when present, a fresh timestamp) + a blank line + the body markdown, ending in
 * exactly one newline. Empty fields are still emitted for type/title/description
 * so the henxels referee can teach the writer what a concept needs.
 */
export function serializeDoc(fm: Frontmatter, body: string, timestamp = nowTimestamp()): string {
  const lines = ['---'];
  lines.push(`type: ${yamlScalar(fm.type)}`);
  lines.push(`title: ${yamlScalar(fm.title)}`);
  lines.push(`description: ${yamlScalar(fm.description)}`);
  if (fm.tags.length > 0) lines.push(`tags: [${fm.tags.map((t) => yamlScalar(t, true)).join(', ')}]`);
  lines.push(`timestamp: ${timestamp}`);
  lines.push('---');
  const trimmedBody = body.replace(/^\n+/, '').replace(/\n+$/, '');
  return `${lines.join('\n')}\n\n${trimmedBody}\n`;
}

/**
 * Split a full doc into (frontmatter data, body) — the inverse of serializeDoc,
 * tolerant like the engine's split_frontmatter (spec/20). Handles the simple
 * `key: scalar` shapes serializeDoc emits plus flow / block tag lists; unparseable
 * or absent frontmatter yields {} and the body is preserved verbatim.
 */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 3);
  const closeAtEof = normalized.endsWith('\n---');
  if (end === -1 && !closeAtEof) return { data: {}, body: normalized };
  const raw = end === -1 ? normalized.slice(4, normalized.length - 4) : normalized.slice(4, end);
  const body = end === -1 ? '' : normalized.slice(end + 5);
  return { data: parseSimpleYaml(raw), body };
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** A deliberately small YAML reader for flat frontmatter (keys + string/list values). */
function parseSimpleYaml(raw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const rest = m[2]!;
    if (rest === '') {
      // A block list may follow: `tags:\n  - a\n  - b`
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]!)) {
        items.push(unquote(lines[++i]!.replace(/^\s*-\s+/, '')));
      }
      data[key] = items.length > 0 ? items : '';
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map((t) => unquote(t));
    } else {
      data[key] = unquote(rest);
    }
  }
  return data;
}

/**
 * A bundle-relative link from one doc to another (kebab paths). Same-directory
 * targets collapse to the bare filename; deeper ones climb with `../`. Keeps the
 * OKF corpus's relative-link style (spec: wiki-conventions) so links resolve.
 */
export function relativeLink(fromDocPath: string, toPath: string): string {
  const from = fromDocPath.split('/').slice(0, -1).filter(Boolean);
  const to = toPath.split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => '..');
  const rel = [...up, ...to.slice(i)].join('/');
  return rel === '' ? (to[to.length - 1] ?? toPath) : rel;
}
