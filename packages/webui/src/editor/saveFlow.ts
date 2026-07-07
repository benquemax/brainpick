/**
 * The guarded-save state machine (spec/50 Writing, spec/70 conflict shape).
 *
 * A PUT /api/docs response is mapped, purely, onto the outcome the editor acts
 * on — the whole point of guarded writes is that the brain teaches the writer, so
 * a 422's henxels `instruction` and a 409's conflict/merge survive intact to the
 * UI. Kept side-effect-free so the flow is unit-tested with a mocked fetch.
 */

export interface MergeProposal {
  content: string;
  strategy: string;
}

export type PutOutcome =
  | { kind: 'ok'; path: string; seq: number; sha: string; warning?: string }
  | { kind: 'violation'; instruction: string }
  | { kind: 'conflict'; currentSha: string | null; theirs: string; instruction: string; merged?: MergeProposal }
  | { kind: 'writesOff'; message: string }
  | { kind: 'auth'; message: string }
  | { kind: 'badRequest'; message: string }
  | { kind: 'error'; message: string };

export type AssetOutcome =
  | { kind: 'ok'; path: string; sha: string; bytes: number }
  | { kind: 'tooBig'; message: string }
  | { kind: 'badRequest'; message: string }
  | { kind: 'writesOff'; message: string }
  | { kind: 'auth'; message: string }
  | { kind: 'error'; message: string };

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function record(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

const GENERIC = {
  violation: 'the brain rejected this write — adjust the page and try again',
  conflict: 'the doc changed since you opened it — reconcile, then save again',
  writesOff: 'writes are disabled on this brain — start the server with [serve] writes = "guarded"',
  auth: 'this brain needs a sign-in before it accepts writes',
  save: 'the save did not go through — check the connection and try again',
};

/** Map (status, JSON body) → the editor outcome. Never throws. */
export function classifyPut(status: number, body: unknown): PutOutcome {
  const b = record(body);
  if (status === 200 || status === 201) {
    const out: PutOutcome = {
      kind: 'ok',
      path: str(b.path, ''),
      seq: typeof b.seq === 'number' ? b.seq : 0,
      sha: str(b.sha, ''),
    };
    if (typeof b.warning === 'string') out.warning = b.warning;
    return out;
  }
  if (status === 422) return { kind: 'violation', instruction: str(b.instruction, GENERIC.violation) };
  if (status === 409) {
    const merged =
      b.merged !== null && typeof b.merged === 'object'
        ? {
            content: str((b.merged as Record<string, unknown>).content, ''),
            strategy: str((b.merged as Record<string, unknown>).strategy, 'merge'),
          }
        : undefined;
    const out: PutOutcome = {
      kind: 'conflict',
      currentSha: typeof b.current_sha === 'string' ? b.current_sha : null,
      theirs: str(b.theirs, ''),
      instruction: str(b.instruction, GENERIC.conflict),
    };
    if (merged && merged.content !== '') out.merged = merged;
    return out;
  }
  if (status === 403) return { kind: 'writesOff', message: str(b.error, GENERIC.writesOff) };
  if (status === 401) return { kind: 'auth', message: str(b.error, GENERIC.auth) };
  if (status === 400) return { kind: 'badRequest', message: str(b.instruction, str(b.error, GENERIC.save)) };
  return { kind: 'error', message: str(b.error, str(b.instruction, GENERIC.save)) };
}

/** Map (status, JSON body) → the image-upload outcome (spec/50 Assets). */
export function classifyAsset(status: number, body: unknown): AssetOutcome {
  const b = record(body);
  if (status === 201 || status === 200) {
    return { kind: 'ok', path: str(b.path, ''), sha: str(b.sha, ''), bytes: typeof b.bytes === 'number' ? b.bytes : 0 };
  }
  if (status === 413) return { kind: 'tooBig', message: str(b.error, 'that image is too large to upload') };
  if (status === 400) return { kind: 'badRequest', message: str(b.error, 'that file is not an accepted image') };
  if (status === 403) return { kind: 'writesOff', message: str(b.error, GENERIC.writesOff) };
  if (status === 401) return { kind: 'auth', message: str(b.error, GENERIC.auth) };
  return { kind: 'error', message: str(b.error, 'the upload failed — try again') };
}
