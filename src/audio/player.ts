/**
 * src/audio/player.ts — the app's own audio player for `r2` lessons.
 *
 * Features (from the mockup + media.md): resume to the second, speed
 * 0.75/1/1.25/1.5/2, ±15 s skip, sleep timer 15/30/60 min, autoplay next,
 * completed at 90% or by the button, Media Session lock-screen controls, and a
 * mini player above the tab bar on other screens.
 *
 * Only ONE lesson player is mounted at a time (media.md): starting a clip stops
 * any other, and third-party embeds are never mounted alongside it. The player
 * builds its media URL from MEDIA_BASE_URL + the R2 key, URL-encoded, never
 * derived from location.
 */

import { MEDIA_BASE_URL } from '../config';
import { devLog } from '../devlog';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export const SLEEP_OPTIONS = [0, 15, 30, 60] as const; // minutes; 0 = off
export const SKIP_SECONDS = 15;
export const COMPLETE_RATIO = 0.9;

/** Build the media URL for an R2 key. Each path segment is URL-encoded so Khmer
 *  / Pāḷi file names resolve exactly; the stored key is never normalised. */
export function mediaUrl(key: string, base = MEDIA_BASE_URL): string {
  const clean = key.replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encoded}`;
}

export interface PlayerCallbacks {
  onTime?(posS: number, durationS: number): void;
  onComplete?(): void;
  onEnded?(): void; // for autoplay-next
  onState?(playing: boolean): void;
}

export interface PlayerHandle {
  readonly audio: HTMLAudioElement;
  play(): Promise<void>;
  pause(): void;
  toggle(): void;
  seek(posS: number): void;
  skip(deltaS: number): void;
  setSpeed(rate: number): void;
  setSleep(minutes: number): void;
  destroy(): void;
}

/**
 * Create a player bound to one R2 key. `startAtS` resumes to the second. The
 * provided audioEl lets tests inject a mock element; production passes a fresh
 * <audio>. Starting playback stops the module-global current player first.
 */
let current: PlayerHandle | null = null;

export function createPlayer(
  key: string,
  startAtS: number,
  cb: PlayerCallbacks = {},
  audioEl?: HTMLAudioElement
): PlayerHandle {
  if (current) current.destroy();

  const audio = audioEl ?? new Audio();
  audio.preload = 'metadata';
  audio.src = mediaUrl(key);
  let completed = false;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  // Until the initial resume-seek has been applied, do NOT report/persist the
  // position: a fresh element fires `timeupdate` at 0 before the seek lands,
  // which would otherwise clobber the saved resume point with 0.
  let resumeApplied = startAtS <= 0;

  const applyResume = () => {
    if (resumeApplied) return;
    if (startAtS > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
      try {
        audio.currentTime = Math.min(startAtS, audio.duration - 0.1);
      } catch (err) {
        devLog('player: seek on load failed', err);
      }
    }
    resumeApplied = true;
  };
  const onLoaded = () => applyResume();
  const onTime = () => {
    if (!resumeApplied) return; // ignore pre-resume ticks (keep the saved point)
    // Only report progress while actually playing. A fresh mount sits paused
    // and may fire a `timeupdate` at 0 (before the user plays); persisting that
    // would clobber the saved resume point.
    if (audio.paused) return;
    const d = audio.duration || 0;
    cb.onTime?.(audio.currentTime, d);
    if (!completed && d > 0 && audio.currentTime >= COMPLETE_RATIO * d) {
      completed = true;
      cb.onComplete?.();
    }
  };
  const onEnded = () => {
    cb.onState?.(false);
    cb.onEnded?.();
  };
  const onPlay = () => cb.onState?.(true);
  const onPause = () => cb.onState?.(false);

  audio.addEventListener('loadedmetadata', onLoaded);
  audio.addEventListener('timeupdate', onTime);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);

  setupMediaSession(audio, cb);

  const handle: PlayerHandle = {
    audio,
    async play() {
      try {
        await audio.play();
      } catch (err) {
        devLog('player: play rejected', err);
      }
    },
    pause() {
      audio.pause();
    },
    toggle() {
      if (audio.paused) void this.play();
      else audio.pause();
    },
    seek(posS) {
      try {
        audio.currentTime = Math.max(0, posS);
      } catch (err) {
        devLog('player: seek failed', err);
      }
    },
    skip(deltaS) {
      this.seek((audio.currentTime || 0) + deltaS);
    },
    setSpeed(rate) {
      audio.playbackRate = rate;
    },
    setSleep(minutes) {
      if (sleepTimer) clearTimeout(sleepTimer);
      sleepTimer = minutes > 0 ? setTimeout(() => audio.pause(), minutes * 60 * 1000) : null;
    },
    destroy() {
      if (sleepTimer) clearTimeout(sleepTimer);
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      try {
        audio.src = '';
      } catch {
        /* ignore */
      }
      if (current === handle) current = null;
    },
  };

  current = handle;
  // Expose the active audio element for e2e only (headless can't observe a
  // detached `new Audio()` via the DOM). Harmless in production; it is just a
  // reference to the element the player already owns.
  try {
    (globalThis as unknown as { __learnAudio?: HTMLAudioElement }).__learnAudio = audio;
  } catch {
    /* ignore */
  }
  return handle;
}

/** The currently-mounted player, if any (for the mini player). */
export function currentPlayer(): PlayerHandle | null {
  return current;
}

function setupMediaSession(audio: HTMLAudioElement, cb: PlayerCallbacks): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => void audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => (audio.currentTime -= SKIP_SECONDS));
    ms.setActionHandler('seekforward', () => (audio.currentTime += SKIP_SECONDS));
    ms.setActionHandler('nexttrack', () => cb.onEnded?.());
  } catch (err) {
    devLog('mediaSession setup failed', err);
  }
}

/** Set the lock-screen metadata for the current lesson. */
export function setMediaMetadata(title: string, artist: string): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    const MM = (globalThis as unknown as { MediaMetadata?: new (init: unknown) => unknown }).MediaMetadata;
    if (MM) navigator.mediaSession.metadata = new MM({ title, artist }) as MediaMetadata;
  } catch (err) {
    devLog('mediaSession metadata failed', err);
  }
}
