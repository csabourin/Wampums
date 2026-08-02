/**
 * @jest-environment jsdom
 */

const mockPermissions = new Set();
let mockIsParent = true;

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
jest.mock('../../spa/utils/SkeletonUtils.js', () => ({ skeletonDashboard: jest.fn(() => '') }));
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
  canAccessAdminPanel: jest.fn(() => false),
  canAccessParentTools: jest.fn(() => mockIsParent),
  canCreateOrganization: jest.fn(() => false),
  canViewCarpools: jest.fn(() => false),
  isParent: jest.fn(() => mockIsParent),
}));
jest.mock('../../spa/utils/DashboardCacheManager.js', () => ({
  DashboardCacheManager: { preloadCachedData: jest.fn() },
}));
jest.mock('../../spa/modules/NewsFeed.js', () => ({
  NewsFeed: class {
    renderContent() { return ''; }
    getIsLoading() { return false; }
  },
}));
jest.mock('../../spa/modules/modals/CarpoolQuickAccessModal.js', () => ({ CarpoolQuickAccessModal: jest.fn() }));
jest.mock('../../spa/utils/DashboardPreferences.js', () => ({
  applyPalette: jest.fn(),
  getDashboardPrefs: jest.fn(() => ({ hiddenTiles: [], collapsedToolGroups: [] })),
  setCollapsedToolGroups: jest.fn(),
}));
jest.mock('../../spa/modules/CommandPalette.js', () => ({ CommandPalette: jest.fn() }));
jest.mock('../../spa/modules/DashboardSettingsModal.js', () => ({ DashboardSettingsModal: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

import { Dashboard } from '../../spa/dashboard.js';
import {
  DASHBOARD_TILES,
  FINANCE_WORKSPACE_EXTRA_TILES,
} from '../../spa/config/dashboard-tiles.js';
import customizationConfig from '../../config/unit_customization.json';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  mockPermissions.clear();
  mockPermissions.add('finance.view');
  mockIsParent = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

test('finance workspace extras inherit their canonical feature visibility metadata', () => {
  expect(FINANCE_WORKSPACE_EXTRA_TILES).toEqual(expect.arrayContaining([
    expect.objectContaining({
      featureKey: 'parent_preview',
      href: '/parent-dashboard',
      parentOnly: true,
      gate: { check: 'parentTools' },
    }),
    expect.objectContaining({
      featureKey: 'account_info',
      href: '/account-info',
    }),
  ]));
});

test('finance workspace honors organization-hidden parent preview', () => {
  const dashboard = new Dashboard({ userRoles: ['parent'] }, { mode: 'finance-focused' });
  dashboard.isLoading = false;
  dashboard.organizationName = '<Unsafe Unit>';
  dashboard.organizationSettings = {
    dashboard_configuration: { hidden_tile_keys: ['parent_preview'] },
  };

  dashboard.render();

  expect(document.querySelector('a[href="/parent-dashboard"]')).toBeNull();
  expect(document.querySelector('a[href="/account-info"]')).not.toBeNull();
  expect(document.querySelector('h2').textContent).toBe('<Unsafe Unit>');
  expect(document.querySelector('h2').innerHTML).toBe('&lt;Unsafe Unit&gt;');
});

test('all dashboard destinations except authenticated account info declare an access gate', () => {
  const ungatedRoutes = DASHBOARD_TILES
    .filter((tile) => !tile.gate)
    .map((tile) => tile.href);

  expect(ungatedRoutes).toEqual(['/account-info']);
});

test('backend dashboard visibility keys match the current configurable tiles', () => {
  const tileFeatureKeys = Array.from(new Set(
    DASHBOARD_TILES.map((tile) => tile.featureKey).filter(Boolean),
  )).sort();

  expect([...customizationConfig.dashboardFeatureKeys].sort()).toEqual(tileFeatureKeys);
});
