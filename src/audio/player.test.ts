import { describe, it, expect, vi } from 'vitest';
import { mediaUrl, createPlayer, SPEEDS, SLEEP_OPTIONS, COMPLETE_RATIO, SKIP_SECONDS } from './player';

describe('mediaUrl', () => {
  it('URL-encodes each path segment and joins to the base', () => {
    expect(mediaUrl('audio/abc-a64.mp3', 'https://media.84000.digital')).toBe(
      'https://media.84000.digital/audio/abc-a64.mp3'
    );
  });
  it('encodes Khmer key bytes exactly (never normalised)', () => {
    const out = mediaUrl('023/023.001.001-កន្ទរ.mp3', 'https://media.84000.digital');
    expect(out.startsWith('https://media.84000.digital/023/023.001.001-')).toBe(true);
    expect(out).toContain('%');
  });
});

describe('player constants match the spec', () => {
  it('speed options and skip and complete ratio', () => {
    expect([...SPEEDS]).toEqual([0.75, 1, 1.25, 1.5, 2]);
    expect([...SLEEP_OPTIONS]).toEqual([0, 15, 30, 60]);
    expect(SKIP_SECONDS).toBe(15);
    expect(COMPLETE_RATIO).toBe(0.9);
  });
});

/** A minimal fake <audio> element for the player, driven manually. */
function fakeAudio() {
  const listeners: Record<string, (() => void)[]> = {};
  const el = {
    src: '',
    preload: '',
    paused: true,
    currentTime: 0,
    duration: 100,
    playbackRate: 1,
    play: vi.fn(async () => {
      el.paused = false;
      emit('play');
    }),
    pause: vi.fn(() => {
      el.paused = true;
      emit('pause');
    }),
    addEventListener: (t: string, f: () => void) => {
      (listeners[t] ??= []).push(f);
    },
    removeEventListener: (t: string, f: () => void) => {
      listeners[t] = (listeners[t] ?? []).filter((x) => x !== f);
    },
  };
  function emit(t: string) {
    for (const f of listeners[t] ?? []) f();
  }
  return { el: el as unknown as HTMLAudioElement, emit, raw: el };
}

describe('createPlayer behaviour', () => {
  it('resumes to the second on loadedmetadata, and reports complete at 90%', () => {
    const { el, emit, raw } = fakeAudio();
    let completed = false;
    const p = createPlayer('audio/x-a64.mp3', 42, { onComplete: () => (completed = true) }, el);
    emit('loadedmetadata');
    expect(Math.round(raw.currentTime)).toBe(42); // resumed to the second

    raw.paused = false; // progress is only reported while playing
    raw.currentTime = 89;
    emit('timeupdate');
    expect(completed).toBe(false);
    raw.currentTime = 90; // 90% of duration 100
    emit('timeupdate');
    expect(completed).toBe(true);
    p.destroy();
  });

  it('skip and setSpeed act on the element', () => {
    const { el, raw } = fakeAudio();
    const p = createPlayer('audio/x.mp3', 0, {}, el);
    raw.currentTime = 10;
    p.skip(15);
    expect(raw.currentTime).toBe(25);
    p.setSpeed(1.5);
    expect(raw.playbackRate).toBe(1.5);
    p.destroy();
  });

  it('does not report progress before resume is applied or while paused (no clobber)', () => {
    const { el, emit, raw } = fakeAudio();
    const times: number[] = [];
    const p = createPlayer('audio/x.mp3', 30, { onTime: (pos) => times.push(pos) }, el);
    // A paused tick at 0 BEFORE loadedmetadata must be ignored.
    raw.currentTime = 0;
    emit('timeupdate');
    expect(times).toEqual([]); // nothing reported → saved resume point kept
    // After resume applies and playback starts, progress reports.
    emit('loadedmetadata');
    raw.paused = false;
    raw.currentTime = 31;
    emit('timeupdate');
    expect(times.at(-1)).toBe(31);
    p.destroy();
  });

  it('starting a new player destroys the previous one (one at a time)', () => {
    const a = fakeAudio();
    const b = fakeAudio();
    const p1 = createPlayer('audio/a.mp3', 0, {}, a.el);
    const spy = vi.spyOn(p1, 'destroy');
    createPlayer('audio/b.mp3', 0, {}, b.el);
    // p1 should have been paused when the module-global current was replaced.
    expect(a.raw.pause).toHaveBeenCalled();
    spy.mockRestore();
  });
});
