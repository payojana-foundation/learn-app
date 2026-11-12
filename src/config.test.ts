import { describe, it, expect } from 'vitest';
import { resolveMediaBase, DEFAULT_MEDIA_BASE_URL, MEDIA_BASE_URL } from './config';
import { mediaUrl } from './audio/player';

// 11 Nov 2026: the Cloudflare build had no VITE_MEDIA_BASE_URL, the base became '' and
// every audio address was relative to the app, so the player could not play.
describe('media base URL', () => {
  it('an unset, empty or blank variable falls back to the committed default', () => {
    for (const v of [undefined, '', '   ', '/', ' / ']) expect(resolveMediaBase(v)).toBe(DEFAULT_MEDIA_BASE_URL);
    expect(DEFAULT_MEDIA_BASE_URL).toBe('https://media.84000.digital');
  });
  it('a set variable wins, without a trailing slash', () => {
    expect(resolveMediaBase('https://media.example.test/')).toBe('https://media.example.test');
  });
  it('the built base is never empty and never the app origin; the audio address is absolute https', () => {
    expect(MEDIA_BASE_URL).not.toBe('');
    const u = mediaUrl('audio/abc-a64.mp3');
    expect(u).toMatch(/^https:\/\/[^/]+\/audio\/abc-a64\.mp3$/);
    expect(u.startsWith('/')).toBe(false);
    expect(u).not.toContain('learn.84000.digital');
  });
});
