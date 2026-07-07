import { describe, expect, it, vi } from 'vitest';
import { classifyAsset, classifyPut, type PutOutcome } from './saveFlow';

describe('classifyPut — the guarded-save state machine', () => {
  it('200 → ok, capturing the new sha as the next base_sha', () => {
    const out = classifyPut(200, { ok: true, path: 'kuu.md', seq: 42, sha: 'abc123' });
    expect(out).toEqual({ kind: 'ok', path: 'kuu.md', seq: 42, sha: 'abc123' });
  });

  it('200 → ok carries a henxels warning through', () => {
    const out = classifyPut(200, { ok: true, path: 'x.md', seq: 1, sha: 'z', warning: 'heads up' });
    expect(out).toMatchObject({ kind: 'ok', warning: 'heads up' });
  });

  it('422 → violation, surfacing the henxels instruction verbatim', () => {
    const instruction = 'every concept links out at least once — add a link to a neighbor';
    const out = classifyPut(422, { ok: false, instruction });
    expect(out).toEqual({ kind: 'violation', instruction });
  });

  it('409 → conflict with a merge proposal (three-way / llm), never auto-applied', () => {
    const out = classifyPut(409, {
      ok: false,
      conflict: true,
      current_sha: 'newsha',
      theirs: '# Theirs\n',
      instruction: 'the doc changed since you read it',
      merged: { content: '# Merged\n', strategy: 'three-way' },
    });
    expect(out).toEqual({
      kind: 'conflict',
      currentSha: 'newsha',
      theirs: '# Theirs\n',
      instruction: 'the doc changed since you read it',
      merged: { content: '# Merged\n', strategy: 'three-way' },
    });
  });

  it('409 → conflict without a merge (manual path) omits merged', () => {
    const out = classifyPut(409, { ok: false, conflict: true, current_sha: 's', theirs: 'x', instruction: 'i' });
    expect(out.kind).toBe('conflict');
    expect((out as Extract<PutOutcome, { kind: 'conflict' }>).merged).toBeUndefined();
  });

  it('403 → writesOff, 401 → auth, each with the server message', () => {
    expect(classifyPut(403, { error: 'writes are disabled' })).toEqual({ kind: 'writesOff', message: 'writes are disabled' });
    expect(classifyPut(401, { error: 'authentication required' })).toEqual({ kind: 'auth', message: 'authentication required' });
  });

  it('400 → badRequest; 500 / non-JSON → error, never throwing', () => {
    expect(classifyPut(400, { ok: false, instruction: 'target a .md path' })).toEqual({
      kind: 'badRequest',
      message: 'target a .md path',
    });
    expect(classifyPut(500, null).kind).toBe('error');
    expect(classifyPut(503, 'not json').kind).toBe('error');
  });
});

describe('classifyAsset — image upload outcomes', () => {
  it('201 → ok with the assets/ path', () => {
    expect(classifyAsset(201, { path: 'assets/reef.png', sha: 'h', bytes: 1234 })).toEqual({
      kind: 'ok',
      path: 'assets/reef.png',
      sha: 'h',
      bytes: 1234,
    });
  });
  it('413 → tooBig, 400 → badRequest, 403 → writesOff', () => {
    expect(classifyAsset(413, { error: 'asset is too large' }).kind).toBe('tooBig');
    expect(classifyAsset(400, { error: 'not an image' }).kind).toBe('badRequest');
    expect(classifyAsset(403, { error: 'off' }).kind).toBe('writesOff');
  });
});

describe('the flow drives a mocked fetch end to end', () => {
  it('a stale save (409) then a retry with current_sha (200) succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 409, json: async () => ({ ok: false, conflict: true, current_sha: 'newsha', theirs: 't', instruction: 'i', merged: { content: '# m', strategy: 'llm' } }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true, path: 'kuu.md', seq: 9, sha: 'finalsha' }) });

    const put = async (baseSha: string) => {
      const res = await fetchMock(baseSha);
      return classifyPut(res.status, await res.json());
    };

    const first = await put('stalesha');
    expect(first.kind).toBe('conflict');
    const retryBase = (first as Extract<PutOutcome, { kind: 'conflict' }>).currentSha!;
    expect(retryBase).toBe('newsha');

    const second = await put(retryBase);
    expect(second).toMatchObject({ kind: 'ok', sha: 'finalsha' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'stalesha');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'newsha');
  });
});
