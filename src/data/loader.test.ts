import { describe, it, expect, beforeEach } from 'vitest';
import { sha256Hex, dataUrl, fetchAndVerify, loadFile } from './loader';
import { resetDbForTests, getDataFile, getDataHash } from '../db';
import type { Manifest } from './types';

async function hashOf(s: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(s).buffer as ArrayBuffer);
}

function jsonResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('dataUrl (P-03)', () => {
  it('is origin-absolute and cache-busted', () => {
    expect(dataUrl('catalog.json', 'abc')).toBe('/data/catalog.json?h=abc');
  });
});

describe('fetchAndVerify (P-01)', () => {
  it('returns parsed JSON when the hash matches', async () => {
    const body = JSON.stringify({ ok: true });
    const sha = await hashOf(body);
    const fetchImpl = (async () => jsonResponse(body)) as unknown as typeof fetch;
    const out = await fetchAndVerify<{ ok: boolean }>(
      { file: 'x.json', updated: '', sha256: sha },
      fetchImpl
    );
    expect(out).toEqual({ ok: true });
  });

  it('returns null on a hash mismatch (never stores unverified bytes)', async () => {
    const fetchImpl = (async () => jsonResponse('{"ok":true}')) as unknown as typeof fetch;
    const out = await fetchAndVerify(
      { file: 'x.json', updated: '', sha256: 'deadbeef' },
      fetchImpl
    );
    expect(out).toBeNull();
  });

  it('returns null on a non-2xx (HTML fallback)', async () => {
    const fetchImpl = (async () =>
      new Response('<html></html>', { status: 404 })) as unknown as typeof fetch;
    const out = await fetchAndVerify({ file: 'x.json', updated: '', sha256: 'x' }, fetchImpl);
    expect(out).toBeNull();
  });
});

describe('loadFile stores only verified data (P-01)', () => {
  beforeEach(() => resetDbForTests());

  it('stores a verified file and its hash', async () => {
    const body = JSON.stringify({ courses: [] });
    const sha = await hashOf(body);
    const manifest: Manifest = {
      generated: '',
      files: { catalog: { file: 'catalog.json', updated: '', sha256: sha } },
    };
    const fetchImpl = (async () => jsonResponse(body)) as unknown as typeof fetch;

    const r1 = await loadFile(manifest, 'catalog', fetchImpl);
    expect(r1.status).toBe('updated');
    expect(await getDataFile('catalog')).toEqual({ courses: [] });
    expect(await getDataHash('catalog')).toBe(sha);

    // Second call with an unchanged hash short-circuits.
    const r2 = await loadFile(manifest, 'catalog', fetchImpl);
    expect(r2.status).toBe('unchanged');
  });

  it('retains previous data on a verification failure', async () => {
    const manifest: Manifest = {
      generated: '',
      files: { catalog: { file: 'catalog.json', updated: '', sha256: 'nope' } },
    };
    const fetchImpl = (async () => jsonResponse('{"courses":[1]}')) as unknown as typeof fetch;
    const r = await loadFile(manifest, 'catalog', fetchImpl);
    expect(r.status).toBe('failed');
  });
});
