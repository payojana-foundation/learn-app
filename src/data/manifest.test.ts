import { describe, it, expect } from 'vitest';
import { parseManifest, fetchManifest } from './manifest';

const good = {
  generated: '2026-10-26',
  files: {
    catalog: { file: 'catalog.json', updated: '2026-10-26', sha256: 'a'.repeat(64) },
    c001: { file: 'courses/c001.json', updated: '2026-10-26', sha256: 'b'.repeat(64) },
  },
};

describe('parseManifest shape validation (P-02)', () => {
  it('accepts a well-formed manifest', () => {
    expect(parseManifest(good)).toEqual(good);
  });

  it('rejects a non-object / HTML fallback', () => {
    expect(parseManifest('<!doctype html>')).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({})).toBeNull();
  });

  it('rejects an entry missing a field', () => {
    expect(parseManifest({ generated: 'x', files: { c: { file: 'a', sha256: 'b' } } })).toBeNull();
  });
});

describe('fetchManifest (P-02)', () => {
  it('returns null when the body is HTML served as 200 (SPA fallback)', async () => {
    const fetchImpl = (async () =>
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    expect(await fetchManifest('/data/manifest.json', fetchImpl)).toBeNull();
  });

  it('returns the manifest for a valid JSON 200', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(good), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    expect(await fetchManifest('/data/manifest.json', fetchImpl)).toEqual(good);
  });

  it('returns null on a non-2xx', async () => {
    const fetchImpl = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchManifest('/data/manifest.json', fetchImpl)).toBeNull();
  });
});
