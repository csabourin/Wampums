/**
 * @jest-environment jsdom
 */

import axe from 'axe-core';

const mockPermissions = new Set();
let mockIsParent = true;
let mockAdminPanel = false;

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
  })),
}));
jest.mock('../../spa/modules/DashboardSettingsModal.js', () => ({ DashboardSettingsModal: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

import { Dashboard } from '../../spa/modules/dashboard/Dashboard.js';
import {
  DASHBOARD_TILES,
  FINANCE_WORKSPACE_EXTRA_TILES,
  TOOL_GROUP_ORDER,
} from '../../spa/config/dashboard-tiles.js';
import { DOMAINS, PALETTES } from '../../spa/config/dashboard-customization.js';
import customizationConfig from '../../config/unit_customization.json';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  mockPermissions.clear();
  mockPermissions.add('finance.view');
  mockIsParent = true;
  mockAdminPanel = false;
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

test('the news screen is offered to every member of the dashboard, not only to those who send messages', () => {
  const tile = DASHBOARD_TILES.find((candidate) => candidate.href === '/communication-history');

  expect(tile.gate).toEqual({ check: 'member' });
});

describe('tool groups separate weekly work from unit set-up', () => {
  const routesIn = (domain) => DASHBOARD_TILES
    .filter((tile) => tile.moment === 'tools' && tile.domain === domain)
    .map((tile) => tile.href);

  test('"Jeunes et familles" holds the reports', () => {
    expect(routesIn('people')).toEqual(expect.arrayContaining([
      '/reports',
      '/group-participant-report',
      '/progression',
      '/parent-dashboard',
    ]));
  });

  test('"Administration de l\'unité" holds the settings changed a few times a year', () => {
    expect(routesIn('admin').sort()).toEqual([
      '/communication-history',
      '/form-permissions',
      '/leader-invitations',
      '/manage-groups',
      '/manage-participants',
      '/manage-users-participants',
      '/parent-invitations',
      '/participant-duplicates',
      '/role-management',
      '/unit-settings',
    ]);
  });

  test('inviting leaders is offered only to those who may also grant them a role', () => {
    const tile = DASHBOARD_TILES.find((item) => item.href === '/leader-invitations');
    expect(tile.gate).toEqual({ all: ['users.invite', 'users.assign_roles'] });
  });

  test('"Administration" holds my account first, then district and system tools', () => {
    const tiles = DASHBOARD_TILES.filter((tile) => tile.domain === 'system');
    expect(tiles.map((tile) => tile.href)).toEqual(['/account-info', '/district', '/create-organization']);
    expect(tiles.every((tile) => tile.href === '/account-info' || tile.gate)).toBe(true);
  });

  test('the new group renders last and every palette colors it', () => {
    expect(TOOL_GROUP_ORDER.slice(-2)).toEqual(['admin', 'system']);
    expect(DOMAINS).toContain('system');
    Object.values(PALETTES).forEach((palette) => {
      expect(palette.domains.system).toEqual(expect.objectContaining({
        bg: expect.any(String), fg: expect.any(String), accent: expect.any(String),
      }));
    });
  });
});

describe('tiles follow the permissions their page acts on', () => {
  const renderAs = (permissions, { adminPanel = true } = {}) => {
    mockPermissions.clear();
    permissions.forEach((permission) => mockPermissions.add(permission));
    mockAdminPanel = adminPanel;
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'] });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.render();
    const group = (domain) => document.querySelector(`.dashboard-v2__group[data-group="${domain}"]`);
    const has = (href) => document.querySelector(`a[href="${href}"]`) !== null;
    return { group, has };
  };

  test('an ordinary leader sees only "Mon compte" under Administration', () => {
    const { group } = renderAs(['participants.view', 'reports.view'], { adminPanel: false });
    const links = Array.from(group('system').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/account-info']);
    expect(group('people').querySelector('a[href="/reports"]')).not.toBeNull();
  });

  test('form access needs forms.manage, not just admin-panel access', () => {
    expect(renderAs(['users.view']).has('/form-permissions')).toBe(false);
    expect(renderAs(['users.view', 'forms.manage']).has('/form-permissions')).toBe(true);
    expect(renderAs(['forms.manage'], { adminPanel: false }).has('/form-permissions')).toBe(false);
  });

  test('unit settings need a permission the page uses', () => {
    expect(renderAs(['users.view']).has('/unit-settings')).toBe(false);
    expect(renderAs(['org.view']).has('/unit-settings')).toBe(true);
    expect(renderAs(['communications.send']).has('/unit-settings')).toBe(true);
    expect(renderAs(['org.edit'], { adminPanel: false }).has('/unit-settings')).toBe(false);
  });

  test('the permission-slip tile needs every read its page makes, not participants.view alone', () => {
    expect(renderAs(['participants.view']).has('/permission-slips')).toBe(false);
    expect(renderAs(['activities.view', 'participants.view', 'groups.view']).has('/permission-slips')).toBe(true);
  });

  test('unit set-up tiles land in "Administration de l\'unité"', () => {
    const { group } = renderAs(['users.invite', 'users.view', 'participants.edit', 'groups.view']);
    const links = Array.from(group('admin').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/manage-groups',
      '/parent-invitations',
      '/manage-users-participants',
      '/participant-duplicates',
      '/communication-history',
    ]);
  });
});

describe('tool groups stay accessible', () => {
  const renderAdmin = () => {
    ['participants.view', 'reports.view', 'org.view', 'users.view', 'roles.view', 'forms.manage']
      .forEach((permission) => mockPermissions.add(permission));
    mockAdminPanel = true;
    mockIsParent = false;
    const dashboard = new Dashboard({ userRoles: ['leader'] });
    dashboard.isLoading = false;
    dashboard.organizationSettings = {};
    dashboard.render();
    dashboard.attachEventListeners();
    return dashboard;
  };

  test('each group toggle is a native button named after its group', () => {
    renderAdmin();
    const toggles = Array.from(document.querySelectorAll('.dashboard-v2__group-toggle'));
    const names = toggles.map((button) => button.textContent.trim());
    expect(names).toEqual(expect.arrayContaining([
      'domain_people',
      'domain_admin',
      'domain_system',
    ]));
    toggles.forEach((button) => {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(['true', 'false']).toContain(button.getAttribute('aria-expanded'));
    });
  });

  test('activating a toggle flips aria-expanded and the collapsed state', () => {
    renderAdmin();
    const group = document.querySelector('.dashboard-v2__group[data-group="admin"]');
    const toggle = group.querySelector('.dashboard-v2__group-toggle');
    const before = toggle.getAttribute('aria-expanded');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe(before === 'true' ? 'false' : 'true');
    expect(group.getAttribute('data-collapsed')).toBe(before);
  });

  test('"Administration" is open on first visit so "Mon compte" is one tap away', () => {
    renderAdmin();
    const toggle = document.querySelector('.dashboard-v2__group[data-group="system"] .dashboard-v2__group-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  test('a tile count is read with its number, not only its unit', () => {
    const dashboard = renderAdmin();
    dashboard.participants = [{ id: 1 }, { id: 2 }];
    dashboard.render();

    const tile = document.querySelector('a[href="/parent-contact-list"]');
    const count = tile.querySelector('.dashboard-v2__tile-stat');
    expect(count.hasAttribute('aria-label')).toBe(false);
    expect(count.textContent.replace(/\s+/g, ' ').trim()).toBe('2 contacts_short');
  });

  test('the tool section has no WCAG A/AA violations', async () => {
    renderAdmin();
    const results = await axe.run(document.querySelector('#moment-tools').closest('section'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom does no layout, so contrast cannot be computed here.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
