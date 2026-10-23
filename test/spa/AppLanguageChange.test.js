/**
 * @jest-environment jsdom
 *
 * Switching language redraws what lives outside the page, so nothing is left
 * in the previous language.
 */

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
// How each start goes; every test describes its own.
const mockStart = { unitFound: false, routerFails: false };
jest.mock('../../spa/router.js', () => ({
  initRouter: jest.fn(() => {
    if (mockStart.routerFails) {
      throw new Error('router failed');
    }
    return { route: jest.fn() };
  }),
  Router: class {},
}));
jest.mock('../../spa/ajax-functions.js', () => ({
  fetchOrganizationId: jest.fn(() => (mockStart.unitFound
    ? Promise.resolve({ organization_id: 1 })
    : Promise.reject(Object.assign(new Error('Unknown domain'), { status: 404 })))),
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

jest.mock('../../spa/modules/demo/DemoBanner.js', () => ({ initDemoBanner: jest.fn() }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @returns {Promise<Object>} The app module, started on a page the way index.html does */
async function startApp() {
  localStorage.clear();
  localStorage.setItem('lang', 'fr');
  document.body.innerHTML = '<main id="app" tabindex="-1"></main>';
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  const module = require('../../spa/app.js');
  await flush();
  await flush();
  return module.app;
}

test('a signed-in visitor who switches language gets the demo banner redrawn in the new one', async () => {
  const app = await startApp();
  const { initDemoBanner } = require('../../spa/modules/demo/DemoBanner.js');
  initDemoBanner.mockClear();
  app.isLoggedIn = true;
  jest.spyOn(app, 'loadTranslation').mockResolvedValue(undefined);

  await app.setLanguage('en');
  await flush();

  expect(initDemoBanner).toHaveBeenCalledTimes(1);
});

test('a signed-out visitor who switches language loads no demo banner', async () => {
  jest.resetModules();
  const app = await startApp();
  const { initDemoBanner } = require('../../spa/modules/demo/DemoBanner.js');
  initDemoBanner.mockClear();
  app.isLoggedIn = false;
  jest.spyOn(app, 'loadTranslation').mockResolvedValue(undefined);

  await app.setLanguage('en');
  await flush();

  expect(initDemoBanner).not.toHaveBeenCalled();
});
