/**
 * The editor's two write calls (spec/50 Writing + Assets). They live in the
 * editor chunk — imported only from the lazily-loaded editor — so the guarded
 * write path (and its classifier) never weighs down the main graph bundle.
 */
import { classifyAsset, classifyPut, type AssetOutcome, type PutOutcome } from './saveFlow';

export type WriteMode = 'create' | 'replace' | 'append_section';

export interface PutArgs {
  content: string;
  baseSha?: string | null;
  mode?: WriteMode;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** PUT /api/docs/{path} — the guarded save. Never throws; maps every outcome. */
export async function putDoc(path: string, args: PutArgs): Promise<PutOutcome> {
  const body: Record<string, unknown> = { content: args.content };
  if (args.baseSha) body.base_sha = args.baseSha;
  if (args.mode) body.mode = args.mode;
  try {
    const res = await fetch(`/api/docs/${encodePath(path)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // non-JSON error body — classify on the status alone
    }
    return classifyPut(res.status, json);
  } catch {
    return { kind: 'error', message: 'could not reach the server — check the connection and try again' };
  }
}

/** POST /api/assets — multipart image upload. Never throws. */
export async function postAsset(file: File): Promise<AssetOutcome> {
  const form = new FormData();
  form.append('file', file, file.name || 'image');
  if (file.name) form.append('name', file.name);
  try {
    const res = await fetch('/api/assets', { method: 'POST', body: form });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // ignore
    }
    return classifyAsset(res.status, json);
  } catch {
    return { kind: 'error', message: 'the upload could not reach the server' };
  }
}
