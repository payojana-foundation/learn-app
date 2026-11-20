/**
 * src/ui/kp.ts — P-14 (bulk 10 P4): the KillerPlayer playlist player, built by Learn.
 *
 * Only called after the learner taps the cover on a partner class page. The iframe address is
 * KP_PLAYLIST_BASE + the class's playlist UUID, re-checked here against the strict uuid-v4
 * pattern (anything else → no iframe). The helper script is KP_HELPER_SRC, added at most once
 * per page load. No pasted HTML is ever inserted; nothing is built with innerHTML.
 */
import { KP_PLAYLIST_BASE, KP_HELPER_SRC } from '../config';
import { UUID4 } from '../data/partners';

/** The minimal DOM this module needs (a real `document` in the app, a fake in unit tests). */
export interface KpDoc {
  createElement(tag: 'iframe' | 'script'): HTMLElement;
  querySelector(sel: string): Element | null;
  head: { appendChild(n: Node): unknown };
}

/** The iframe address for a UUID, or null when the UUID is not a strict v4. Pure. */
export function kpFrameUrl(uuid: string): string | null {
  return typeof uuid === 'string' && UUID4.test(uuid) ? KP_PLAYLIST_BASE + uuid : null;
}

/** Build (not attach) the one iframe for a class, or null. */
export function buildKpFrame(doc: KpDoc, uuid: string, title: string): HTMLElement | null {
  const src = kpFrameUrl(uuid);
  if (!src) return null;
  const f = doc.createElement('iframe');
  f.setAttribute('src', src);
  f.setAttribute('title', title);
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
  f.setAttribute('allowfullscreen', '');
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  f.setAttribute('data-kp-frame', '');
  return f;
}

/** Add the helper script once (a second call does nothing). Returns true when it was added now. */
export function ensureKpHelper(doc: KpDoc): boolean {
  if (doc.querySelector('script[data-kp-embed-helper]')) return false;
  const s = doc.createElement('script');
  s.setAttribute('src', KP_HELPER_SRC);
  s.setAttribute('async', '');
  s.setAttribute('data-kp-embed-helper', '');
  doc.head.appendChild(s);
  return true;
}
