import './style.css';
import { devLog } from './devlog';
import { registerSW } from 'virtual:pwa-register';
import { startApp, currentLang, STRINGS, displayString } from './app';

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
    if (!reloadArmed) return;
    reloadArmed = false;
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
}

void startApp();
registerServiceWorker();
