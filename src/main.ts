import './style.css';
import { devLog } from './devlog';
import { registerSW } from 'virtual:pwa-register';
import { startApp, currentLang, STRINGS, displayString } from './app';
import { setVersionChangeHandler } from './db';

/**
 * src/main.ts — entry point.
 *
 * Boots the screen controller (src/app.ts) and registers the service worker
 * with the prompt-style update (reliable updates). The controller owns the
 * language, routing, data load, and all screens.
 */

const UPDATE_CHECK_MS = 60 * 60 * 1000; // hourly

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  let reloadArmed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadArmed && !reloadArmedForDb) return;
    reloadArmed = false;
    reloadArmedForDb = false;
    window.location.reload();
  });

  let promptOpen = false;
  const updateSW = registerSW({
    onNeedRefresh() {
      if (promptOpen) return;
      promptOpen = true;
      const accepted = window.confirm(displayString(STRINGS.APP_UPDATE[currentLang()]));
      promptOpen = false;
      if (accepted) {
        reloadArmed = true;
        void updateSW(true);
      }
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      void registration.update().catch((err) => devLog('sw update check failed', err));
      setInterval(() => {
        void registration.update().catch((err) => devLog('sw periodic update failed', err));
      }, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void registration.update().catch((err) => devLog('sw visibility update failed', err));
        }
      });
    },
    onOfflineReady() {
      devLog('service worker: offline ready');
    },
  });
  applyUpdate = updateSW;
}

/**
 * DB upgrade safety (bulk-07 P3): a newer tab needs to upgrade IndexedDB. This
 * tab's connection is already closed (src/db/index.ts); ask with the EXISTING
 * update prompt and reload if accepted. One prompt at a time.
 */
let dbPromptOpen = false;
setVersionChangeHandler(() => {
  if (dbPromptOpen) return;
  dbPromptOpen = true;
  const accepted = window.confirm(displayString(STRINGS.APP_UPDATE[currentLang()]));
  dbPromptOpen = false;
  if (accepted) acceptUpdate();
});

/**
 * The accepted-update path (P-06): activate the waiting service worker and
 * reload once it takes control. A plain reload would keep the OLD shell (the
 * new SW waits under registerType 'prompt') and meet the newer DB again. If no
 * new SW is waiting, reload after a short wait.
 */
let applyUpdate: ((reload: boolean) => Promise<void>) | null = null;
let reloadArmedForDb = false;
function acceptUpdate(): void {
  if (!applyUpdate || !('serviceWorker' in navigator)) {
    window.location.reload();
    return;
  }
  reloadArmedForDb = true;
  void applyUpdate(true);
  setTimeout(() => {
    if (reloadArmedForDb) window.location.reload();
  }, 3000);
}

void startApp();
registerServiceWorker();
