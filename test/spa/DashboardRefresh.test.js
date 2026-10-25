/**
 * @jest-environment jsdom
 *
 * Live sync draws the dashboard again when its data changed elsewhere. The
 * dashboard on display stays until the new one is ready, instead of being
 * replaced by its loading skeleton for the length of the reload.
 */

import axe from 'axe-core';

const mockPermissions = new Set();
let mockIsParent = false;
const mockAdminPanel = false;

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    ROLES: {
      DISTRICT: 'district',
      UNIT_ADMIN: 'unitadmin',
      ADMINISTRATION: 'administration',
      DEMO_ADMIN: 'demoadmin',
      FINANCE: 'finance',
      LEADER: 'leader',
      PARENT: 'parent',
      DEMO_PARENT: 'demoparent',
    },
  },
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  CONFIG: { ROLES: {} },
  getParticipants: jest.fn(),
  getGroups: jest.fn(),
  getCurrentOrganizationId: jest.fn(),
  getOrganizationSettings: jest.fn(),
}));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  getAttendanceDates: jest.fn(),
  getAttendance: jest.fn(),
  getNextMeetingInfo: jest.fn(),
  getPermissionSlips: jest.fn(),
  getMedicationDistributions: jest.fn(),
}));

jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({
  getCachedData: jest.fn(),
  setCachedData: jest.fn(),
  clearActivityRelatedCaches: jest.fn(),
}));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => { element.innerHTML = html; },
  loadStylesheet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/SkeletonUtils.js', () => ({
  skeletonDashboard: jest.fn(() => '<section class="dashboard-page loading-state" aria-busy="true">loading</section>'),
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  getTodayISO: jest.fn(() => '2026-08-02'),
  formatDate: jest.fn((value) => value),
}));
jest.mock('../../spa/utils/ParticipantRoleUtils.js', () => ({
  normalizeParticipantList: (participants) => participants,
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn((permission) => mockPermissions.has(permission)),
  hasAnyPermission: jest.fn((...permissions) => permissions.some((permission) => mockPermissions.has(permission))),
  canAccessAdminPanel: jest.fn(() => mockAdminPanel),
  canAccessParentTools: jest.fn(() => mockIsParent),
  canCreateOrganization: jest.fn(() => false),
  canViewCarpools: jest.fn(() => false),
  canFollowPermissionSlips: jest.fn(() => !mockIsParent
    && ['activities.view', 'participants.view', 'groups.view'].every((permission) => mockPermissions.has(permission))),
  isParent: jest.fn(() => mockIsParent),
  holdsFamilyRole: jest.fn(() => mockIsParent),
}));
jest.mock('../../spa/utils/DashboardCacheManager.js', () => ({
  DashboardCacheManager: { preloadCachedData: jest.fn() },
}));
jest.mock('../../spa/modules/modals/CarpoolQuickAccessModal.js', () => ({ CarpoolQuickAccessModal: jest.fn() }));
jest.mock('../../spa/utils/DashboardPreferences.js', () => ({
  applyPalette: jest.fn(),
  getDashboardPrefs: jest.fn(() => ({ hiddenTiles: [], collapsedToolGroups: [] })),
  setCollapsedToolGroups: jest.fn(),
}));
jest.mock('../../spa/modules/CommandPalette.js', () => ({
  CommandPalette: jest.fn().mockImplementation(() => ({
    attachGlobalShortcut: jest.fn(),
    setTiles: jest.fn(),
    detach: jest.fn(),
  })),
}));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

import { Dashboard } from '../../spa/modules/dashboard/Dashboard.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

/**
 * Make the dashboard's loads wait until the test lets them finish.
 * @returns {function(): Promise<void>} Finishes the loads
 */
function holdLoads() {
  let finish;
  const loaded = new Promise((resolve) => {
    finish = resolve;
  });
  jest.spyOn(Dashboard.prototype, 'fetchOrganizationInfo').mockImplementation(() => loaded);
  jest.spyOn(Dashboard.prototype, 'preloadDashboardData').mockImplementation(() => loaded);
  jest.spyOn(Dashboard.prototype, 'refreshDashboardCounters').mockResolvedValue();
  jest.spyOn(Dashboard.prototype, 'prefetchCriticalPages').mockResolvedValue();
  jest.spyOn(Dashboard.prototype, 'listenForConnectivityChanges').mockImplementation(() => {});
  return async () => {
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

/**
 * @param {boolean} refreshing - Whether the router is drawing the screen on display again
 * @returns {Object} The app, as the dashboard sees it
 */
function appWithRouter(refreshing) {
  return { router: { isRefreshingScreen: () => refreshing }, showMessage: jest.fn() };
}

const app = () => document.getElementById('app');

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  mockPermissions.clear();
  mockIsParent = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('opening the dashboard shows its loading skeleton until the data arrives', async () => {
  const finishLoads = holdLoads();
  const dashboard = new Dashboard(appWithRouter(false));

  const initialised = dashboard.init();
  expect(app().querySelector('.loading-state')).not.toBeNull();

  await finishLoads();
  await initialised;
  expect(app().querySelector('.loading-state')).toBeNull();
  expect(app().querySelector('.dashboard-v2')).not.toBeNull();
  dashboard.destroy();
});

test('a dashboard drawn again in place keeps the one on display, marked busy, until the new one is ready', async () => {
  app().innerHTML = '<div class="dashboard-v2"><h1>12 points</h1></div>';
  const finishLoads = holdLoads();
  const dashboard = new Dashboard(appWithRouter(true));

  const initialised = dashboard.init();
  expect(app().querySelector('.loading-state')).toBeNull();
  expect(app().textContent).toContain('12 points');
  expect(app().getAttribute('aria-busy')).toBe('true');

  await finishLoads();
  await initialised;
  expect(app().textContent).not.toContain('12 points');
  expect(app().querySelector('.dashboard-v2')).not.toBeNull();
  expect(app().hasAttribute('aria-busy')).toBe(false);
  const results = await axe.run(app(), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
  dashboard.destroy();
});

test('drawn again over something other than a dashboard, it shows the skeleton', () => {
  app().innerHTML = '<p>another screen</p>';
  holdLoads();
  const dashboard = new Dashboard(appWithRouter(true));

  dashboard.init();

  expect(app().querySelector('.loading-state')).not.toBeNull();
  dashboard.destroy();
});

test('leaving while the refreshed dashboard loads does not leave the next screen marked busy', () => {
  app().innerHTML = '<div class="dashboard-v2"><h1>12 points</h1></div>';
  holdLoads();
  const dashboard = new Dashboard(appWithRouter(true));
  dashboard.init();

  dashboard.destroy();

  expect(app().hasAttribute('aria-busy')).toBe(false);
});

test('a failed refresh shows the error, not a busy old dashboard', async () => {
  app().innerHTML = '<div class="dashboard-v2"><h1>12 points</h1></div>';
  jest.spyOn(Dashboard.prototype, 'fetchOrganizationInfo').mockRejectedValue(new Error('offline'));
  jest.spyOn(Dashboard.prototype, 'preloadDashboardData').mockResolvedValue();
  const dashboard = new Dashboard(appWithRouter(true));

  await dashboard.init();

  expect(app().textContent).toContain('error_loading_dashboard');
  expect(app().hasAttribute('aria-busy')).toBe(false);
  dashboard.destroy();
});
