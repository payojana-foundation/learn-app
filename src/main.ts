import './style.css';
import { devLog } from './devlog';
import { initLang, type Lang } from './lang';
import { t } from './strings';
import { renderVersionLabel } from './version-label';
import { registerSW } from 'virtual:pwa-register';
import { displayString, STRINGS } from './strings';

/**
 * src/main.ts — entry point and app shell init.
 *
 * P1 (empty shell):
 *  - Resolve and apply the interface language (?lang → cookie lang_84000 → km),
 *    set <html lang> and <html data-lang>.
 *  - Render the bottom tab bar (Home · Search · My Learning · More) and the
 *    version label, so a deploy is visibly the new build.
 *  - Register the service worker; on a waiting SW, show the update prompt.
 *
 * P4 replaces the placeholder panels with the real screens. No course/teacher
 * data or scripture is touched here.
 */

const UPDATE_CHECK_MS = 60 * 60 * 1000; // hourly

/** Render the four-item bottom tab bar and the version label into the shell. */
function renderShell(lang: Lang): void {
  const tabbar = document.getElementById('tabbar');
  const main = document.getElementById('app-main');
  if (!tabbar || !main) {
    devLog('renderShell: shell elements missing');
    return;
  }

  const tabs: { key: keyof typeof STRINGS; path: string }[] = [
    { key: 'TAB_HOME', path: '/' },
    { key: 'TAB_SEARCH', path: '/search' },
    { key: 'TAB_MY', path: '/my' },
    { key: 'TAB_MORE', path: '/more' },
  ];

  tabbar.replaceChildren();
  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.dataset.path = tab.path;
    btn.className = 'flex-1 py-3 text-sm';
    btn.textContent = t(tab.key, lang);
    tabbar.appendChild(btn);
  }

  // Placeholder content for the empty shell; the version label lives here until
  // the More screen owns it (P4).
  main.replaceChildren();
  const label = document.createElement('div');
  label.id = 'shell-version';
  renderVersionLabel(label);
  main.appendChild(label);
}

/**
 * Service worker registration + update prompt (reliable updates). With a
 * prompt-type registration the browser only looks for a new SW on navigation,
 * so a PWA left open could miss a deploy; we also check on register, hourly,
 * and when the app is foregrounded. The version switch is never silent — the
 * user accepts the prompt before the reload.
 */
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
      const accepted = window.confirm(displayString(STRINGS.APP_UPDATE[currentLang]));
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

let currentLang: Lang = 'km';

function main(): void {
  currentLang = initLang();
  renderShell(currentLang);
  registerServiceWorker();
}

main();
