/**
 * @jest-environment jsdom
 *
 * When the app cannot start (here, the unit cannot be found while online),
 * the person sees a page in their language with a way to try again, never
 * raw translation keys — even though the translations never arrived.
 */

import axe from 'axe-core';

jest.mock('@fortawesome/fontawesome-free/css/fontawesome.min.css', () => ({}));
jest.mock('@fortawesome/fontawesome-free/css/solid.min.css', () => ({}));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), isDebugMode: () => false,
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    DEFAULT_LANG: 'fr',
    UI: { HOMEPAGE_URL: 'https://wampums.app' },
    STORAGE_KEYS: {},
  },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/router.js', () => ({ initRouter: jest.fn(), Router: class {} }));
jest.mock('../../spa/ajax-functions.js', () => ({
  fetchOrganizationId: jest.fn(() => Promise.reject(Object.assign(new Error('Unknown domain'), { status: 404 }))),
  fetchOrganizationJwt: jest.fn(),
  getOrganizationSettings: jest.fn(),
  getPublicOrganizationSettings: jest.fn(),
}));
jest.mock('../../spa/api/api-core.js', () => ({ makeApiRequest: jest.fn() }));
jest.mock('../../spa/modules/push/PushSubscription.js', () => ({ registerPushSubscription: jest.fn() }));
jest.mock('../../spa/pwa-update-manager.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../spa/offline-init.js', () => ({ initOfflineSupport: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: { syncPendingData: jest.fn() } }));
jest.mock('../../spa/utils/DashboardPreferences.js', () => ({ applyPalette: jest.fn() }));
jest.mock('../../spa/modules/app-recovery/StaleClientRecovery.js', () => ({
  checkForStaleClient: jest.fn(() => Promise.resolve()),
  installChunkErrorRecovery: jest.fn(),
}));

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const RAW_KEY = /\b[a-z]+(?:_[a-z]+)+\b/;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Start the app the way index.html does, with a language remembered from the
 * last visit.
 * @param {?string} lang - Stored language
 * @param {?string} fallback - Stored fallback of an optional language
 */
async function startWith(lang, fallback = null) {
  jest.resetModules();
  localStorage.clear();
  if (lang) {
    localStorage.setItem('lang', lang);
  }
  if (fallback) {
    localStorage.setItem('lang_fallback', fallback);
  }
  document.documentElement.lang = 'en';
  document.title = 'Wampums';
  document.body.innerHTML = `
    <a class="skip-link" href="#app">Skip to main content</a>
    <main id="app" tabindex="-1"></main>
    <a href="/politique-de-confidentialite.html" class="privacy-policy-link">Politique de confidentialité</a>
  `;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  require('../../spa/app.js');
  await flush();
  await flush();
}

function app() {
  return document.getElementById('app');
}

test('a French reader sees the failure explained in French, with a reload button', async () => {
  await startWith('fr');

  expect(app().querySelector('h1').textContent).toBe('Erreur d’application');
  expect(app().querySelector('[role="alert"]').textContent).toMatch(/^Un problème est survenu/);
  expect(app().querySelector('button').textContent).toBe('Recharger');
  expect(app().textContent).not.toMatch(RAW_KEY);
  expect(document.documentElement.lang).toBe('fr');
  expect(document.title).toBe('Erreur d’application - Wampums');
  expect(document.querySelector('.skip-link').textContent).toBe('Aller au contenu principal');
});

test('an English reader sees it in English, page chrome included', async () => {
  await startWith('en');

  expect(app().querySelector('h1').textContent).toBe('Application Error');
  expect(app().querySelector('.error-actions a').textContent).toBe('Go to homepage');
  expect(document.documentElement.lang).toBe('en');
  expect(document.querySelector('.privacy-policy-link').textContent).toBe('Privacy policy (in French)');
  expect(document.body.textContent).not.toMatch(RAW_KEY);
});

test('a reader of an optional language sees the unit\'s fallback, and the page says which language it is in', async () => {
  await startWith('uk', 'fr');

  expect(app().querySelector('h1').textContent).toBe('Erreur d’application');
  expect(document.documentElement.lang).toBe('fr');
});

test('the startup error page has no WCAG A/AA violations', async () => {
  await startWith('fr');
  const results = await axe.run(document.body, AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});
