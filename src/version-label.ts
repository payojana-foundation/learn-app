/**
 * src/version-label.ts — the small build-version label component.
 *
 * Renders "v<hash> · <date>" into a host element. It is shown in the app shell
 * (More tab in v1) so a user can report exactly which deployed build they are
 * running — the practical fix for the "my phone still shows the old version"
 * class of bug (reliable-updates work).
 */

import { versionLabel } from './version';

/** Create the version-label element. */
export function createVersionLabel(doc: Document = document): HTMLElement {
  const el = doc.createElement('p');
  el.className = 'version-label';
  el.setAttribute('data-testid', 'version-label');
  el.textContent = versionLabel();
  return el;
}

/** Render the version label into `host` (replacing any previous one). */
export function renderVersionLabel(host: HTMLElement, doc: Document = document): void {
  const existing = host.querySelector('.version-label');
  if (existing) existing.remove();
  host.appendChild(createVersionLabel(doc));
}
