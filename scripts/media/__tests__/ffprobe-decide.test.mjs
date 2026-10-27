import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decideType } from '../ffprobe-decide.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf-8'));

describe('decideType', () => {
  it('audio-only → audio', () => {
    expect(decideType(load('probe-audio.json'))).toBe('audio');
  });

  it('real video stream (named .mp3) → video', () => {
    expect(decideType(load('probe-video-named-mp3.json'))).toBe('video');
  });

  it('audio with cover-art picture → audio (attached_pic is not real video)', () => {
    expect(decideType(load('probe-audio-with-coverart.json'))).toBe('audio');
  });

  it('throws when there is no audio stream', () => {
    expect(() => decideType({ streams: [{ codec_type: 'video' }] })).toThrow(/no audio/);
  });
});
